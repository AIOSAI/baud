import { useEffect, useState } from "react";

import { InterfaceControls } from "./InterfaceSettings";
import MemorySettings from "./MemorySettings";

import type { BaudSettings } from "../types";

/** The header gear's dialog: navigation and chrome only; each leaf keeps its own save, one per owner's file. */

type SectionId = "interface" | "memory";

interface Section {
  id: SectionId;
  label: string;
  /** The tab's hover line - what is behind it, in the operator's words. */
  summary: string;
}

const SECTIONS: readonly Section[] = [
  {
    id: "interface",
    label: "interface",
    summary: "startup agent, poll cadence, bell, hook sounds — this face's own settings",
  },
  {
    id: "memory",
    label: "memory",
    summary: "@memory's fleet-wide config: rollover defaults, entry caps, per-agent overrides",
  },
];

interface SettingsDialogProps {
  /** Fleet names for the interface leaf's startup list, in card order. */
  agents: string[];
  /** What the app is running on right now - the dialog opens on the truth. */
  settings: BaudSettings;
  /** A save landed: the whole document, exactly as the backend wrote it. */
  onSaved: (settings: BaudSettings) => void;
  onClose: () => void;
}

export default function SettingsDialog({
  agents,
  settings,
  onSaved,
  onClose,
}: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>("interface");

  // Escape closes; it does not step back a tab, both sections share the screen.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="baud-settings-scrim" onPointerDown={onClose}>
      <div
        className="baud-settings-panel baud-interface-panel"
        role="dialog"
        aria-label="BAUD settings"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="baud-settings-head">
          <span className="baud-settings-title">BAUD · settings</span>
          <button
            type="button"
            className="baud-settings-close"
            title="close - nothing is written until save"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <nav className="baud-settings-tabs" role="tablist" aria-label="settings sections">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={section === entry.id}
              className={`baud-settings-tab ${section === entry.id ? "baud-settings-tab-on" : ""}`}
              title={entry.summary}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        {/* Unmounted, not hidden: each leaf re-reads its file on mount, since another writer may have changed it. */}
        {section === "interface" ? (
          <InterfaceControls agents={agents} settings={settings} onSaved={onSaved} />
        ) : (
          <div className="baud-settings-leaf">
            <MemorySettings />
          </div>
        )}
      </div>
    </div>
  );
}
