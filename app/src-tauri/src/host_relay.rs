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
//! Where the server listens and which token to send are this machine's
//! `host_relay.json` in the app's config dir (`url`, `token_path`, both
//! optional, typed in the settings dialog). An unset address is asked of
//! @api's own door, `drone @api host-api config`, once per process, and asked
//! again after a call that could not connect; @api's store is never read. An
//! unset token path is the `baud-desktop` receipt (`~/.secrets/aipass/host_api/
//! baud-desktop.token`, the raw token, 0600). That receipt, when missing, is
//! minted once through `drone @api host-api issue-token`; a typed path is
//! never minted, since its token belongs to another machine's server. Both
//! drone lines run in the operator's login shell so `drone` resolves from
//! their PATH however the window was launched. A 401 is never re-minted:
//! `issue-token` refuses to overwrite a receipt, and a revoked token is the
//! operator's decision to undo.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

/// The receipt's label: one desktop, one token, visible as such in `tokens.json`.
const TOKEN_LABEL: &str = "baud-desktop";

const SETTINGS_FILE: &str = "host_relay.json";

/// Long enough for `machine_processes` (it samples cpu) and a new project's
/// scaffold; short enough that a hung server reads as unreachable, not a freeze.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// A login shell plus one drone verb; past this the line is hung, not slow.
const DRONE_TIMEOUT: Duration = Duration::from_secs(30);

/// Concurrent first calls would each run `issue-token`; the second would be
/// refused for the receipt the first just wrote.
static MINT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The base URL @api's door last named; cleared when a call cannot connect.
static LEARNED_BASE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Mirrored by `RelaySettings` in `types.ts`. `None` is "ask @api" / "the
/// default receipt".
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct RelaySettings {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub token_path: Option<String>,
}

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

/// `line` in the operator's login shell, killed past `limit`. Output stays
/// piped to the end, which holds for drone's few-line answers.
fn login_shell(line: &str, limit: Duration) -> Result<Output, String> {
    let shell = crate::pty::user_shell();
    let mut child = Command::new(&shell)
        .args(["-l", "-c", line])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("could not run '{line}' in {shell}: {err}"))?;
    let deadline = Instant::now() + limit;
    while child.try_wait().map_err(|err| format!("'{line}': {err}"))?.is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("'{line}' did not finish within {}s", limit.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    child.wait_with_output().map_err(|err| format!("'{line}': {err}"))
}

fn said(output: &Output) -> String {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if err.is_empty() { String::from_utf8_lossy(&output.stdout).trim().to_string() } else { err }
}

/// The `host:` and `port:` lines of `drone @api host-api config`.
// shortcut: parses @api's text form, which is all it prints; move to a --json form when @api ships one.
pub(crate) fn parse_config_text(text: &str) -> Result<Bind, String> {
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.trim().strip_prefix(name).map(|rest| rest.trim().to_string()))
            .filter(|value| !value.is_empty())
    };
    let host = field("host:").ok_or("no 'host:' line")?;
    let port = field("port:").ok_or("no 'port:' line")?;
    let port = port.parse().map_err(|_| format!("port '{port}' is not a number"))?;
    Ok(Bind { host, port })
}

fn ask_bind() -> Result<Bind, String> {
    let line = "drone @api host-api config";
    let output = login_shell(line, DRONE_TIMEOUT)?;
    let text = String::from_utf8_lossy(&output.stdout);
    parse_config_text(&text).map_err(|why| {
        format!(
            "'{line}' named no address ({why}; exit {}): {}. \
             Type the host API address in settings > host API",
            output.status.code().map_or("signal".into(), |code| code.to_string()),
            said(&output)
        )
    })
}

/// `http://host[:port]`, no path, query or credentials; https is refused
/// because the client is built without TLS.
pub(crate) fn checked_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim())
        .map_err(|err| format!("host API address '{raw}' is not a URL: {err}"))?;
    if url.scheme() != "http" {
        return Err(format!("host API address must start with http://, got '{raw}'"));
    }
    if url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(format!("host API address must be http://host:port and nothing more, got '{raw}'"));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Blank strings clear a field; a set address must pass `checked_url`, a set
/// token path must be absolute.
pub(crate) fn checked_settings(settings: RelaySettings) -> Result<RelaySettings, String> {
    let blank = |value: Option<String>| value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let url = blank(settings.url).map(|url| checked_url(&url)).transpose()?;
    let token_path = blank(settings.token_path);
    if let Some(path) = &token_path {
        if !Path::new(path).is_absolute() {
            return Err(format!("token receipt path must be absolute, got '{path}'"));
        }
    }
    Ok(RelaySettings { url, token_path })
}

pub(crate) fn read_settings_at(path: &Path) -> Result<RelaySettings, String> {
    let document = crate::settings::read_object(path)?;
    serde_json::from_value(Value::Object(document))
        .map_err(|err| format!("{}: {err}", path.display()))
}

pub(crate) fn write_settings_at(path: &Path, settings: RelaySettings) -> Result<RelaySettings, String> {
    let settings = checked_settings(settings)?;
    let document = serde_json::to_value(&settings).map_err(|err| err.to_string())?;
    crate::settings::write_atomically(path, &document)?;
    Ok(settings)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|err| format!("no config dir for BAUD: {err}"))
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
pub(crate) fn read_receipt(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
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

fn unauthorized_sentence(receipt: &Path, typed: bool) -> String {
    let cure = if typed {
        "Mint a fresh one on the host (`drone @api host-api issue-token <label> --scope operate`) \
         and copy its receipt over this one."
    } else {
        "Either revoke it and let the desktop mint a fresh one: `drone @api host-api revoke-token <id>` \
         then remove that receipt; or remove the receipt alone if the token is already revoked."
    };
    format!(
        "the host API refused the desktop's token (the receipt at {} names a revoked or unknown token). {cure}",
        receipt.display()
    )
}

/// `drone @api host-api issue-token` through the login shell, then the receipt.
fn mint(home: &Path) -> Result<String, String> {
    let _guard = MINT_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let receipt = receipt_path(home);
    if let Some(token) = read_receipt(&receipt)? {
        return Ok(token);
    }
    let line = format!("drone @api host-api issue-token {TOKEN_LABEL} --scope operate");
    let output = login_shell(&line, DRONE_TIMEOUT)?;
    match read_receipt(&receipt)? {
        Some(token) => Ok(token),
        None => Err(format!(
            "'{line}' wrote no receipt at {} (exit {}): {}",
            receipt.display(),
            output.status.code().map_or("signal".into(), |code| code.to_string()),
            said(&output)
        )),
    }
}

async fn learned_base() -> Result<String, String> {
    if let Some(base) = LEARNED_BASE.lock().unwrap_or_else(|p| p.into_inner()).clone() {
        return Ok(base);
    }
    let base = tauri::async_runtime::spawn_blocking(ask_bind)
        .await
        .map_err(|err| format!("host_api_call: the address lookup did not finish: {err}"))?
        .map(|bind| base_url(&bind))?;
    *LEARNED_BASE.lock().unwrap_or_else(|p| p.into_inner()) = Some(base.clone());
    Ok(base)
}

/// The relay's machine settings, as stored.
#[tauri::command]
pub fn host_relay_settings_read(app: tauri::AppHandle) -> Result<RelaySettings, String> {
    read_settings_at(&settings_path(&app)?)
}

/// Replace both fields; a blank one clears. Returns what was written.
#[tauri::command]
pub fn host_relay_settings_write(app: tauri::AppHandle, settings: RelaySettings) -> Result<RelaySettings, String> {
    let written = write_settings_at(&settings_path(&app)?, settings)?;
    *LEARNED_BASE.lock().unwrap_or_else(|p| p.into_inner()) = None;
    Ok(written)
}

/// One `/v1` call on the window's behalf. `Err` is a call that never reached
/// the server (fence, settings, lookup, mint, network); any HTTP answer is
/// `Ok`, with a 401's body replaced by the cure, so the page parses every
/// answer one way.
#[tauri::command]
pub async fn host_api_call(app: tauri::AppHandle, request: HostRequest) -> Result<HostResponse, String> {
    let settings = read_settings_at(&settings_path(&app)?)?;
    relay(home_dir()?, settings, request).await
}

pub(crate) async fn relay(home: PathBuf, settings: RelaySettings, request: HostRequest) -> Result<HostResponse, String> {
    let (base, typed_url) = match &settings.url {
        Some(url) => (checked_url(url)?, true),
        None => (learned_base().await?, false),
    };
    let url = fenced_url(&base, &request)?;
    let (receipt, typed_token) = match &settings.token_path {
        Some(path) => (PathBuf::from(path), true),
        None => (receipt_path(&home), false),
    };
    let token = match read_receipt(&receipt)? {
        Some(token) => token,
        None if typed_token => {
            return Err(format!(
                "no token receipt at {} (the path typed in settings > host API). Copy the host's \
                 receipt there; a typed path is never minted",
                receipt.display()
            ))
        }
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

    let response = match call.send().await {
        Ok(response) => response,
        Err(err) => {
            if !typed_url {
                *LEARNED_BASE.lock().unwrap_or_else(|p| p.into_inner()) = None;
            }
            let from = if typed_url { "settings > host API" } else { "drone @api host-api config" };
            return Err(format!("cannot reach the host API at {base} (from {from}): {err}"));
        }
    };
    let status = response.status().as_u16();
    if status == 401 {
        let body = serde_json::json!({
            "error": { "code": "unauthorized", "message": unauthorized_sentence(&receipt, typed_token) }
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

    /// `drone @api host-api config` as it prints with no tty.
    const CONFIG_TEXT: &str = "╭─────────────────╮\n│ Host API Config │\n╰─────────────────╯\n\n\n  host: 100.81.115.55\n  port: 8787\n  face: /x/dist-phone (checkout)\n  phone.html: present\n\n✅ Bind address would be accepted\n";

    #[test]
    fn config_text_yields_host_and_port() {
        assert_eq!(parse_config_text(CONFIG_TEXT).unwrap(), Bind { host: "100.81.115.55".into(), port: 8787 });
    }

    #[test]
    fn config_text_without_a_bind_is_refused() {
        assert!(parse_config_text("  port: 8787\n").unwrap_err().contains("'host:'"));
        assert!(parse_config_text("  host: 1.2.3.4\n").unwrap_err().contains("'port:'"));
        assert!(parse_config_text("  host: 1.2.3.4\n  port: 99999\n").unwrap_err().contains("not a number"));
        assert!(parse_config_text("  host:\n  port: 8787\n").is_err());
    }

    #[test]
    fn typed_address_is_plain_http_host_and_port() {
        assert_eq!(checked_url(" http://100.81.115.55:8787/ ").unwrap(), "http://100.81.115.55:8787");
        assert_eq!(checked_url("http://macbook.tail1234.ts.net:8787").unwrap(), "http://macbook.tail1234.ts.net:8787");
        for (raw, rule) in [
            ("https://100.81.115.55:8787", "http://"),
            ("100.81.115.55:8787", "host API address"),
            ("http://100.81.115.55:8787/v1", "nothing more"),
            ("http://100.81.115.55:8787?x=1", "nothing more"),
            ("http://u:p@100.81.115.55:8787", "nothing more"),
            ("not a url", "not a URL"),
        ] {
            assert!(checked_url(raw).unwrap_err().contains(rule), "{raw}");
        }
    }

    #[test]
    fn settings_blank_clears_and_relative_token_path_is_refused() {
        let blank = RelaySettings { url: Some("  ".into()), token_path: Some("".into()) };
        assert_eq!(checked_settings(blank).unwrap(), RelaySettings::default());
        let relative = RelaySettings { url: None, token_path: Some("tokens/baud.token".into()) };
        assert!(checked_settings(relative).unwrap_err().contains("absolute"));
    }

    #[test]
    fn settings_round_trip_and_absent_file_reads_unset() {
        let home = scratch_home("settings");
        let path = home.join("config").join(SETTINGS_FILE);
        assert_eq!(read_settings_at(&path).unwrap(), RelaySettings::default());
        let token = home.join("mac.token").display().to_string();
        let typed = RelaySettings { url: Some("http://100.81.115.55:8787/".into()), token_path: Some(token.clone()) };
        let written = write_settings_at(&path, typed).unwrap();
        assert_eq!(written, RelaySettings { url: Some("http://100.81.115.55:8787".into()), token_path: Some(token) });
        assert_eq!(read_settings_at(&path).unwrap(), written);
        assert!(write_settings_at(&path, RelaySettings { url: Some("https://x".into()), token_path: None }).is_err());
        assert_eq!(read_settings_at(&path).unwrap(), written, "a refused write leaves the file alone");
    }

    #[test]
    fn a_typed_token_path_that_is_absent_is_refused_never_minted() {
        let home = scratch_home("typedtoken");
        let missing = home.join("absent.token").display().to_string();
        let settings = RelaySettings { url: Some("http://127.0.0.1:9".into()), token_path: Some(missing.clone()) };
        let err = tauri::async_runtime::block_on(relay(home, settings, request("GET", "/v1/machine"))).unwrap_err();
        assert!(err.contains(&missing) && err.contains("never minted"), "{err}");
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
        assert_eq!(read_receipt(&receipt_path(&home)).unwrap(), None);
        std::fs::write(receipt_path(&home), "tok-abc").unwrap();
        assert_eq!(read_receipt(&receipt_path(&home)).unwrap().as_deref(), Some("tok-abc"));
        std::fs::write(receipt_path(&home), "tok-abc\n").unwrap();
        assert_eq!(read_receipt(&receipt_path(&home)).unwrap().as_deref(), Some("tok-abc"));
        std::fs::write(receipt_path(&home), "  \n").unwrap();
        assert!(read_receipt(&receipt_path(&home)).is_err());
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

    /// Live: the address from @api's door, the operator's host-api, and a mint on first run. `cargo test -- --ignored live_`.
    #[test]
    #[ignore]
    fn live_machine_vitals_through_the_relay() {
        let answer = tauri::async_runtime::block_on(relay(home_dir().unwrap(), RelaySettings::default(), request("GET", "/v1/machine"))).unwrap();
        println!("machine_vitals -> {} {}", answer.status, answer.body);
        assert_eq!(answer.status, 200);
        assert!(serde_json::from_str::<Value>(&answer.body).unwrap().is_object());
    }

    #[test]
    fn unauthorized_names_the_receipt_and_both_cures() {
        let home = scratch_home("cure");
        let said = unauthorized_sentence(&receipt_path(&home), false);
        assert!(said.contains(&receipt_path(&home).display().to_string()));
        assert!(said.contains("drone @api host-api revoke-token <id>"));
        assert!(said.contains("remove the receipt"));
        let typed = unauthorized_sentence(Path::new("/x/mac.token"), true);
        assert!(typed.contains("/x/mac.token") && typed.contains("issue-token") && typed.contains("copy its receipt"));
    }
}
