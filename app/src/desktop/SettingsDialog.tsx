import { useEffect, useState } from "react";

import { InterfaceControls } from "./InterfaceSettings";
import MemorySettings from "./MemorySettings";

import type { BaudSettings } from "../types";

/**
 * THE DESK'S SETTINGS DIALOG - what the header gear opens, and nothing more.
 *
 * WHY IT EXISTS. The gear used to open the interface panel directly, and the
 * memory dials rode along at the bottom of it. That put @memory's fleet-wide
 * config behind a door labelled "interface", which is the look and feel of this
 * face: two owners' files under one word (Patrick's ruling, and the reason for
 * this round). Memory needed a placement of its own, and a second gear in the
 * header is how an app ends up with two places called settings - so the gear
 * opens ONE dialog and the sections sit inside it.
 *
 * IT OWNS NAVIGATION AND CHROME, NEVER A CONTROL. Both leaves are the same
 * components the phone mounts: `InterfaceControls` writes BAUD's own settings
 * file, `MemorySettings` writes @memory's, and each keeps its own save because
 * one button writing two owners' files is exactly what the split is against.
 * Adding a section here is a row in `SECTIONS` and a leaf below - the same
 * shape the phone's settings screen took, for the same reason.
 *
 * THE PHONE'S HOME IS A LIST OF DOORS AND THIS IS A ROW OF TABS, deliberately:
 * a thumb navigates a screen at a time, a pointer does not need to, and two
 * sections would make a whole screen of navigation to reach either one.
 */

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

  // Escape closes, as it did when the gear opened the interface panel bare.
  // It does NOT step back to the first tab: both sections are on screen at
  // once here, so there is no level to climb out of.
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
        {/* The title stays put while the tabs move - the section is named by
            the tab that is lit, and a heading repeating it would say the same
            word twice on a 340px panel. */}
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

        {/* MOUNTED, NOT HIDDEN: the leaf that is off is unmounted, so switching
            tabs re-reads its file on the way back in. Both panels read on mount
            precisely because another window or a shell may have written the
            file since, and a leaf kept alive behind a tab would quietly turn
            that discipline off. */}
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
