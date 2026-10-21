//! The relay to @api's host-api: the one door the window has to the phone's
//! `/v1` lanes (git app, backup, machine, roots, new project, cross-project
//! reads).
//!
//! The webview never touches the host-api itself. Its CSP has no `connect-src`,
//! the server answers no CORS preflight, and an operate token in page storage
//! is a token any injected script could read. So this process does the HTTP:
//! the page hands over `(method, path, query, body)` - the same wire shape
//! `transport.http.ts` builds for the phone - and gets `(status, body)` back
//! for the same parsing. The token never crosses into the page.
//!
//! Where the server listens is @api's config store
//! (`~/.secrets/aipass/host_api/config.json`, `host` and `port`, read-only
//! here). The token is the `baud-desktop` receipt beside it: the raw token,
//! 0600, no newline. A missing receipt is minted once through `drone @api
//! host-api issue-token`, run in the operator's login shell so `drone`
//! resolves from their PATH however the window was launched. A 401 with a
//! receipt present is never re-minted: `issue-token` refuses to overwrite a
//! receipt, and a revoked token is the operator's decision to undo.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The receipt's label: one desktop, one token, visible as such in `tokens.json`.
const TOKEN_LABEL: &str = "baud-desktop";

/// @api's defaults when its config store holds no bind (`handlers/host/config.py`).
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8787;

/// Long enough for `machine_processes` (it samples cpu) and a new project's
/// scaffold; short enough that a hung server reads as unreachable, not a freeze.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Concurrent first calls would each run `issue-token`; the second would be
/// refused for the receipt the first just wrote.
static MINT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Deserialize)]
pub struct HostRequest {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct HostResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, PartialEq)]
pub(crate) struct Bind {
    pub host: String,
    pub port: u16,
}

pub(crate) fn host_api_dir(home: &Path) -> PathBuf {
    home.join(".secrets").join("aipass").join("host_api")
}

pub(crate) fn receipt_path(home: &Path) -> PathBuf {
    host_api_dir(home).join(format!("{TOKEN_LABEL}.token"))
}

fn home_dir() -> Result<PathBuf, String> {
    ["HOME", "USERPROFILE"]
        .iter()
        .filter_map(std::env::var_os)
        .find(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "cannot find the home directory (HOME is unset)".to_string())
}

/// The bind from @api's config store. Absent file or key is @api's default; a
/// file that does not parse is an error, never a silent default.
pub(crate) fn read_bind(home: &Path) -> Result<Bind, String> {
    let path = host_api_dir(home).join("config.json");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Bind { host: DEFAULT_HOST.into(), port: DEFAULT_PORT })
        }
        Err(err) => return Err(format!("cannot read {}: {err}", path.display())),
    };
    let document: Value = serde_json::from_str(&text)
        .map_err(|err| format!("{} is not JSON: {err}", path.display()))?;
    let host = match document.get("host") {
        None | Some(Value::Null) => DEFAULT_HOST.to_string(),
        Some(Value::String(host)) if !host.trim().is_empty() => host.trim().to_string(),
        Some(other) => return Err(format!("{}: host is not a name: {other}", path.display())),
    };
    let port = match document.get("port") {
        None | Some(Value::Null) => DEFAULT_PORT,
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|n| u16::try_from(n).ok())
            .ok_or_else(|| format!("{}: port {n} is out of range", path.display()))?,
        Some(Value::String(s)) => s
            .trim()
            .parse()
            .map_err(|_| format!("{}: port '{s}' is not a number", path.display()))?,
        Some(other) => return Err(format!("{}: port is not a number: {other}", path.display())),
    };
    Ok(Bind { host, port })
}

/// A server bound to every interface is reached on loopback; an IPv6 literal
/// needs its brackets in a URL.
pub(crate) fn base_url(bind: &Bind) -> String {
    let host = match bind.host.as_str() {
        "0.0.0.0" => "127.0.0.1",
        "::" | "[::]" => "[::1]",
        other => other,
    };
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{}", bind.port)
    } else {
        format!("http://{host}:{}", bind.port)
    }
}

/// `None` when the receipt is absent; an empty receipt is an error, since
/// sending it would read as a revoked token.
pub(crate) fn read_receipt(home: &Path) -> Result<Option<String>, String> {
    let path = receipt_path(home);
    match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => Err(format!("{} is empty", path.display())),
        Ok(text) => Ok(Some(text.trim().to_string())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("cannot read {}: {err}", path.display())),
    }
}

/// The fence: GET or POST, a path under `/v1/` that a URL parser leaves as it
/// is (no `..`, no query or fragment smuggled in the path).
pub(crate) fn fenced_url(base: &str, request: &HostRequest) -> Result<reqwest::Url, String> {
    if request.method != "GET" && request.method != "POST" {
        return Err(format!("host_api_call: method must be GET or POST, got '{}'", request.method));
    }
    if !request.path.starts_with("/v1/") {
        return Err(format!("host_api_call: path must start with /v1/, got '{}'", request.path));
    }
    let mut url = reqwest::Url::parse(&format!("{base}{}", request.path))
        .map_err(|err| format!("host_api_call: '{}' is not a URL path: {err}", request.path))?;
    if url.path() != request.path || url.query().is_some() || url.fragment().is_some() {
        return Err(format!(
            "host_api_call: path must be a plain /v1/ path (no '..', '?' or '#'), got '{}'",
            request.path
        ));
    }
    if !request.query.is_empty() {
        url.query_pairs_mut().extend_pairs(request.query.iter());
    }
    Ok(url)
}

fn unauthorized_sentence(home: &Path) -> String {
    format!(
        "the host API refused the desktop's token (the receipt at {} names a revoked or unknown token). \
         Either revoke it and let the desktop mint a fresh one: `drone @api host-api revoke-token <id>` \
         then remove that receipt; or remove the receipt alone if the token is already revoked.",
        receipt_path(home).display()
    )
}

/// `drone @api host-api issue-token` through the login shell, then the receipt.
fn mint(home: &Path) -> Result<String, String> {
    let _guard = MINT_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(token) = read_receipt(home)? {
        return Ok(token);
    }
    let shell = crate::pty::user_shell();
    let line = format!("drone @api host-api issue-token {TOKEN_LABEL} --scope operate");
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", &line])
        .output()
        .map_err(|err| format!("could not run '{line}' in {shell}: {err}"))?;
    match read_receipt(home)? {
        Some(token) => Ok(token),
        None => {
            let said = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let said = if said.is_empty() { String::from_utf8_lossy(&output.stdout).trim().to_string() } else { said };
            Err(format!(
                "'{line}' wrote no receipt at {} (exit {}): {said}",
                receipt_path(home).display(),
                output.status.code().map_or("signal".into(), |code| code.to_string())
            ))
        }
    }
}

/// One `/v1` call on the window's behalf. `Err` is a call that never reached
/// the server (fence, config, mint, network); any HTTP answer is `Ok`, with a
/// 401's body replaced by the cure, so the page parses every answer one way.
#[tauri::command]
pub async fn host_api_call(request: HostRequest) -> Result<HostResponse, String> {
    let home = home_dir()?;
    let base = base_url(&read_bind(&home)?);
    let url = fenced_url(&base, &request)?;
    let token = match read_receipt(&home)? {
        Some(token) => token,
        None => {
            let home = home.clone();
            tauri::async_runtime::spawn_blocking(move || mint(&home))
                .await
                .map_err(|err| format!("host_api_call: the token mint did not finish: {err}"))??
        }
    };

    let client = reqwest::Client::builder()
        .timeout(CALL_TIMEOUT)
        .build()
        .map_err(|err| format!("host_api_call: no HTTP client: {err}"))?;
    let mut call = if request.method == "POST" { client.post(url) } else { client.get(url) }
        .bearer_auth(&token)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(body) = &request.body {
        call = call
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }

    let response = call
        .send()
        .await
        .map_err(|err| format!("cannot reach the host API at {base}: {err}"))?;
    let status = response.status().as_u16();
    if status == 401 {
        let body = serde_json::json!({
            "error": { "code": "unauthorized", "message": unauthorized_sentence(&home) }
        });
        return Ok(HostResponse { status, body: body.to_string() });
    }
    let body = response
        .text()
        .await
        .map_err(|err| format!("the host API answered {status} but the body did not arrive: {err}"))?;
    Ok(HostResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_home(tag: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("baud-relay-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(host_api_dir(&home)).unwrap();
        home
    }

    fn request(method: &str, path: &str) -> HostRequest {
        HostRequest { method: method.into(), path: path.into(), query: BTreeMap::new(), body: None }
    }

    #[test]
    fn bind_defaults_when_the_store_has_no_config() {
        let home = scratch_home("noconfig");
        assert_eq!(read_bind(&home).unwrap(), Bind { host: "127.0.0.1".into(), port: 8787 });
    }

    #[test]
    fn bind_reads_host_and_port_and_defaults_missing_keys() {
        let home = scratch_home("config");
        let config = host_api_dir(&home).join("config.json");
        std::fs::write(&config, r#"{"host": "100.81.115.55", "port": 9000, "face_dir": "/x"}"#).unwrap();
        assert_eq!(read_bind(&home).unwrap(), Bind { host: "100.81.115.55".into(), port: 9000 });
        std::fs::write(&config, r#"{"port": "8800"}"#).unwrap();
        assert_eq!(read_bind(&home).unwrap(), Bind { host: "127.0.0.1".into(), port: 8800 });
    }

    #[test]
    fn bind_refuses_a_config_it_cannot_read() {
        let home = scratch_home("badconfig");
        let config = host_api_dir(&home).join("config.json");
        std::fs::write(&config, "{not json").unwrap();
        assert!(read_bind(&home).unwrap_err().contains("is not JSON"));
        std::fs::write(&config, r#"{"port": 70000}"#).unwrap();
        assert!(read_bind(&home).unwrap_err().contains("out of range"));
    }

    #[test]
    fn base_url_reaches_a_wildcard_bind_on_loopback() {
        let bind = |host: &str| Bind { host: host.into(), port: 8787 };
        assert_eq!(base_url(&bind("100.81.115.55")), "http://100.81.115.55:8787");
        assert_eq!(base_url(&bind("0.0.0.0")), "http://127.0.0.1:8787");
        assert_eq!(base_url(&bind("::")), "http://[::1]:8787");
        assert_eq!(base_url(&bind("fd7a::1")), "http://[fd7a::1]:8787");
    }

    #[test]
    fn receipt_is_read_trimmed_and_absent_is_none() {
        let home = scratch_home("receipt");
        assert_eq!(read_receipt(&home).unwrap(), None);
        std::fs::write(receipt_path(&home), "tok-abc").unwrap();
        assert_eq!(read_receipt(&home).unwrap().as_deref(), Some("tok-abc"));
        std::fs::write(receipt_path(&home), "tok-abc\n").unwrap();
        assert_eq!(read_receipt(&home).unwrap().as_deref(), Some("tok-abc"));
        std::fs::write(receipt_path(&home), "  \n").unwrap();
        assert!(read_receipt(&home).is_err());
    }

    #[test]
    fn fence_admits_v1_get_and_post_with_the_query_encoded() {
        let base = "http://127.0.0.1:8787";
        let mut get = request("GET", "/v1/files");
        get.query.insert("branch".into(), "devpulse".into());
        get.query.insert("file".into(), ".ai_mail.local/inbox.json".into());
        let url = fenced_url(base, &get).unwrap();
        assert_eq!(url.path(), "/v1/files");
        assert_eq!(url.query(), Some("branch=devpulse&file=.ai_mail.local%2Finbox.json"));
        assert!(fenced_url(base, &request("POST", "/v1/verbs/lock")).is_ok());
    }

    #[test]
    fn fence_refuses_other_methods_and_paths() {
        let base = "http://127.0.0.1:8787";
        for (method, path, rule) in [
            ("DELETE", "/v1/fleet", "method must be GET or POST"),
            ("get", "/v1/fleet", "method must be GET or POST"),
            ("GET", "/v2/fleet", "must start with /v1/"),
            ("GET", "/v1", "must start with /v1/"),
            ("GET", "http://evil/v1/x", "must start with /v1/"),
            ("GET", "/v1/../admin", "plain /v1/ path"),
            ("GET", "/v1/files?branch=x", "plain /v1/ path"),
            ("GET", "/v1/files#x", "plain /v1/ path"),
        ] {
            let err = fenced_url(base, &request(method, path)).unwrap_err();
            assert!(err.contains(rule), "{method} {path}: {err}");
        }
    }

    /// Live: the operator's host-api, and a mint on first run. `cargo test -- --ignored live_`.
    #[test]
    #[ignore]
    fn live_machine_vitals_through_the_relay() {
        let answer = tauri::async_runtime::block_on(host_api_call(request("GET", "/v1/machine"))).unwrap();
        println!("machine_vitals -> {} {}", answer.status, answer.body);
        assert_eq!(answer.status, 200);
        assert!(serde_json::from_str::<Value>(&answer.body).unwrap().is_object());
    }

    #[test]
    fn unauthorized_names_the_receipt_and_both_cures() {
        let home = scratch_home("cure");
        let said = unauthorized_sentence(&home);
        assert!(said.contains(&receipt_path(&home).display().to_string()));
        assert!(said.contains("drone @api host-api revoke-token <id>"));
        assert!(said.contains("remove the receipt"));
    }
}
