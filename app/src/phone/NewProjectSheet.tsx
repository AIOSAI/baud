import { useState } from "react";

import { verbNewProject } from "../host";
import type { NewProjectResult } from "../types";
import { DEFAULT_TEMPLATE, NAME_HINT, TEMPLATES, nameRefusal } from "./lib/newProject";
import { useSystemBack } from "./lib/systemBack";

interface NewProjectSheetProps {
  onClose: () => void;
  onCreated: (result: NewProjectResult) => void;
}

export default function NewProjectSheet({ onClose, onCreated }: NewProjectSheetProps) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>(DEFAULT_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useSystemBack(onClose);

  async function create() {
    const typed = name.trim();
    const refusal = nameRefusal(typed);
    if (refusal) {
      setSaid(refusal);
      return;
    }
    setBusy(true);
    setSaid(null);
    try {
      onCreated(await verbNewProject(typed, template));
    } catch (cause) {
      setSaid(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div className="baud-agent-scrim" onPointerDown={onClose}>
      <form
        className="baud-agent-card baud-newproject"
        role="dialog"
        aria-label="new project"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void create();
        }}
      >
        <header className="baud-newproject-head">
          <span className="baud-newproject-title">new project</span>
          <button type="button" className="baud-newproject-close" title="close" onClick={onClose}>
            ×
          </button>
        </header>
        <input
          className="baud-phone-door-input baud-newproject-name"
          value={name}
          placeholder="name"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="baud-newproject-hint">{NAME_HINT}</p>
        <div className="baud-newproject-chips" role="radiogroup" aria-label="template">
          {TEMPLATES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={choice === template}
              className={`baud-newproject-chip ${choice === template ? "baud-newproject-chip-on" : ""}`}
              disabled={busy}
              onClick={() => setTemplate(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
        <button type="submit" className="baud-newproject-create" disabled={busy}>
          {busy ? "creating…" : "create"}
        </button>
        {said ? <p className="baud-phone-said">{said}</p> : null}
      </form>
    </div>
  );
}
