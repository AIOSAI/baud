import { useState } from "react";

import FilesScreen from "../phone/FilesScreen";
import GitApp from "../phone/git/GitApp";
import InboxScreen from "../phone/InboxScreen";
import { renderMarkdown } from "../phone/Markdown";
import MemoryScreen from "../phone/MemoryScreen";
import PlansScreen from "../phone/PlansScreen";
import Reader from "../phone/Reader";
import { isMarkdownRef } from "../phone/lib/markdown";
import type { CardView, PhoneView } from "./phoneView";

interface CardScreensProps {
  view: CardView;
  onOpen: (view: PhoneView) => void;
  onClose: () => void;
}

/** Every door here is pressed on a card, so `‹` names the card, as the phone's trail does off a tile. */
const BACK = "card";

/**
 * A card door's designed screen, mounted as the phone mounts it (PhoneApp.tsx); its floor's back closes the tab.
 * Reference: docs/desktop/window-and-cards.md
 */
export default function CardScreens({ view, onClose }: CardScreensProps) {
  switch (view.screen) {
    case "inbox":
      return (
        <InboxScreen
          key={`${view.project}/${view.branch}/${view.openId ?? ""}`}
          branch={view.branch}
          project={view.project}
          openId={view.openId}
          closeLabel={view.openId !== undefined ? "feed" : BACK}
          onClose={onClose}
        />
      );
    case "plans":
      return (
        <PlansScreen
          key={`${view.project}/${view.branch}`}
          branch={view.branch}
          project={view.project}
          backLabel={BACK}
          onClose={onClose}
        />
      );
    case "memory":
      return (
        <MemoryScreen
          /* The tab in front is read once, at mount. */
          key={`${view.project}/${view.branch}/${view.initialTab ?? ""}`}
          branch={view.branch}
          project={view.project}
          initialTab={view.initialTab}
          backLabel={BACK}
          onClose={onClose}
        />
      );
    case "branch-git":
      return (
        <GitApp
          /* The app's floor is decided once at mount. */
          key={`${view.project}/${view.branch}`}
          branch={view.branch}
          project={view.project}
          grain="branch"
          onClose={onClose}
        />
      );
    case "branch-files":
      return (
        <BranchFiles
          key={`${view.project}/${view.branch}`}
          branch={view.branch}
          project={view.project}
          onClose={onClose}
        />
      );
  }
}

/** The phone's browse → reader pair inside one tab: a file's `‹ folder` returns to the folder it was opened from. */
function BranchFiles({ branch, project, onClose }: { branch: string; project: string; onClose: () => void }) {
  const [at, setAt] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState<string | null>(null);

  if (reading !== null) {
    return (
      <Reader
        target={{ ref: reading, title: reading, kind: "file", project }}
        preview={isMarkdownRef(reading) ? renderMarkdown : undefined}
        backLabel="folder"
        onClose={() => setReading(null)}
      />
    );
  }
  return (
    <FilesScreen
      /* The start directory is read once into state. */
      key={`${project}/${branch}@${at ?? ""}`}
      branch={branch}
      project={project}
      start=""
      at={at}
      backLabel={BACK}
      onOpenFile={(ref, _title, where) => {
        setAt(where);
        setReading(ref);
      }}
      onClose={onClose}
    />
  );
}
