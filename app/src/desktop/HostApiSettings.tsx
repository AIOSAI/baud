import { useEffect, useState } from "react";
import { hostRelaySettingsRead, hostRelaySettingsWrite } from "../host";

import type { RelaySettings } from "../types";

/**
 * Where this machine's relay finds the host API, saved to this machine's config dir, never a project's.
 * Reference: docs/desktop/settings.md
 */

/** Tauri rejects with the backend's error string, not an Error. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function HostApiSettings() {
  const [base, setBase] = useState<RelaySettings | null>(null);
  const [url, setUrl] = useState("");
  const [tokenPath, setTokenPath] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function adopt(next: RelaySettings) {
    setBase(next);
    setUrl(next.url ?? "");
    setTokenPath(next.token_path ?? "");
  }

  useEffect(() => {
    let mounted = true;
    hostRelaySettingsRead()
      .then((next) => mounted && adopt(next))
      .catch((err) => mounted && setReadError(message(err)));
    return () => {
      mounted = false;
    };
  }, []);

  const pending =
    base !== null && (url.trim() !== (base.url ?? "") || tokenPath.trim() !== (base.token_path ?? ""));

  function save() {
    setSaving(true);
    setWriteError(null);
    hostRelaySettingsWrite({ url: url.trim() || null, token_path: tokenPath.trim() || null })
      .then((next) => {
        adopt(next);
        setSaved(true);
      })
      .catch((err) => setWriteError(message(err)))
      .finally(() => setSaving(false));
  }

  return (
    <>
      <label className="baud-settings-row">
        <span className="baud-settings-label">address</span>
        <input
          type="text"
          className="baud-settings-text"
          placeholder="asked of drone @api host-api config"
          title="http://host:port of the machine serving the host API; blank asks @api on this machine"
          spellCheck={false}
          value={url}
          disabled={base === null}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label className="baud-settings-row">
        <span className="baud-settings-label">token receipt</span>
        <input
          type="text"
          className="baud-settings-text"
          placeholder="this machine's baud-desktop receipt, minted on first call"
          title="absolute path to a receipt issued by that host's @api; a typed path is never minted"
          spellCheck={false}
          value={tokenPath}
          disabled={base === null}
          onChange={(event) => setTokenPath(event.target.value)}
        />
      </label>

      {readError ? (
        <p className="baud-settings-error" role="alert">
          read failed: {readError}
        </p>
      ) : null}
      {writeError ? (
        <p className="baud-settings-error" role="alert">
          write failed: {writeError}
        </p>
      ) : null}

      <footer className="baud-settings-foot">
        <span className={`baud-settings-note ${saved && !pending ? "baud-settings-note-saved" : ""}`}>
          {pending ? "changes pending" : saved ? "saved" : "no changes"}
        </span>
        <button type="button" className="baud-settings-save" disabled={!pending || saving} onClick={save}>
          {saving ? "saving…" : "save"}
        </button>
      </footer>
    </>
  );
}
