/** The strip's four apps, each the phone's own screen inside a workbench tab. Reference: docs/desktop/apps.md */

import { useEffect, useMemo, useState } from "react";

import { fleetSnapshot } from "../host";
import type { FleetSnapshot } from "../types";
import BackupApp from "../phone/backup/BackupApp";
import { isCertificateOpen, renderCertificate } from "../phone/Certificate";
import FilesScreen from "../phone/FilesScreen";
import { openingCard } from "../phone/FleetWheel";
import GitApp from "../phone/git/GitApp";
import { lockLine, useLockState } from "../phone/lib/lock";
import { machineFaces, useMachineVitals } from "../phone/lib/machine";
import { isMarkdownRef } from "../phone/lib/markdown";
import { useRepoCount } from "../phone/lib/pollers";
import { type Browse, backWord } from "../phone/lib/trail";
import MachineSheet from "../phone/MachineSheet";
import { renderMarkdown } from "../phone/Markdown";
import Reader from "../phone/Reader";
import RootsScreen from "../phone/RootsScreen";
import { MACHINE_TILES } from "./appCards";
import type { AppView, PhoneView } from "./phoneView";

interface AppScreensProps {
  view: AppView;
  onOpen: (view: PhoneView) => void;
  onClose: () => void;
}

export default function AppScreens({ view, onClose }: AppScreensProps) {
  switch (view.screen) {
    case "git":
      return <GitTab key={view.project} project={view.project} onClose={onClose} />;
    case "backup":
      // The desktop's relay token is minted with `operate` scope (host_relay.rs).
      return <BackupApp key={view.project} project={view.project} scope="operate" onClose={onClose} />;
    case "files":
      return <FilesTab onClose={onClose} />;
    case "machine":
      return <MachineTab onClose={onClose} />;
  }
}

/** Repo grain, addressed by the seat's manager as the phone's `repoCitizen` is; one fleet read stands in for the phone's poll. */
function GitTab({ project, onClose }: { project: string; onClose: () => void }) {
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  useEffect(() => {
    let mounted = true;
    fleetSnapshot(project)
      .then((next) => {
        if (mounted) setFleet(next);
      })
      .catch(() => {
        // Left unread: GitApp then says the fleet has not answered, never "no agent".
      });
    return () => {
      mounted = false;
    };
  }, [project]);

  const seat = fleet?.project ?? project;
  const repoCitizen = fleet ? (openingCard(fleet.branches, seat)?.name ?? "") : "";
  const repoCounts = useRepoCount(repoCitizen, seat);

  return (
    <GitApp
      branch={repoCitizen}
      project={seat}
      projectLabel={seat || "anchor"}
      fleetAnswered={fleet !== null}
      changed={repoCounts[seat] ?? null}
      onClose={onClose}
    />
  );
}

/** The phone's roots, browse and reader as one stack; a file's `‹ folder` reopens the browse where it stood. */
function FilesTab({ onClose }: { onClose: () => void }) {
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [reading, setReading] = useState<{ ref: string; from: Browse } | null>(null);

  if (reading) {
    const { ref, from } = reading;
    return (
      <Reader
        target={{ ref, title: ref, kind: "file", project: from.project, root: from.root }}
        render={isCertificateOpen(from.name, from.start, ref) ? renderCertificate : undefined}
        preview={isMarkdownRef(ref) ? renderMarkdown : undefined}
        backLabel="folder"
        onClose={() => {
          setReading(null);
          setBrowse(from);
        }}
      />
    );
  }

  if (browse) {
    return (
      <FilesScreen
        key={`${browse.root ?? ""}:${browse.project}/${browse.name}/${browse.start}@${browse.at ?? ""}`}
        branch={browse.name}
        project={browse.project}
        root={browse.root}
        start={browse.start}
        at={browse.at}
        backLabel={backWord([{ kind: "roots" }])}
        onOpenFile={(ref, _title, at) => {
          setReading({ ref, from: { ...browse, at } });
          setBrowse(null);
        }}
        onClose={() => setBrowse(null)}
      />
    );
  }

  return (
    <RootsScreen
      onPick={(root) =>
        setBrowse({ name: root.name || root.kind, project: "", start: "", root: root.kind })
      }
      onClose={onClose}
    />
  );
}

/** The monitor row as tiles over the phone's sheet, with the lock state read but never set. */
function MachineTab({ onClose }: { onClose: () => void }) {
  const read = useMachineVitals(true);
  const faces = useMemo(() => machineFaces(read), [read]);
  const [card, setCard] = useState<string | null>(null);
  const { read: lock } = useLockState();

  return (
    <div className="baud-appscreen-machine">
      <div className="baud-appscreen-machine-body">
        {card ? (
          <MachineSheet card={card} read={read} onClose={() => setCard(null)} />
        ) : (
          <section className="baud-phone-reader">
            <header className="baud-phone-reader-head">
              <button type="button" className="baud-phone-back" onClick={onClose}>
                ‹ close
              </button>
              <span className="baud-phone-reader-title">machine · live</span>
            </header>
            <div className="baud-appscreen-tiles">
              {MACHINE_TILES.map((tile) => {
                const face = faces[tile.key];
                return (
                  <button
                    key={tile.key}
                    type="button"
                    className="baud-appscreen-tile"
                    title={`open ${tile.name}`}
                    onClick={() => setCard(tile.key)}
                  >
                    <span className="baud-appscreen-tile-mark">{tile.mark}</span>
                    <span
                      className={`baud-appscreen-tile-value ${
                        face?.absent ? "baud-appscreen-tile-absent" : ""
                      }`}
                    >
                      {face ? face.value : "…"}
                      {face?.unit && !face.absent ? <small>{face.unit}</small> : null}
                    </span>
                    <span className="baud-appscreen-tile-name">{tile.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <p className="baud-appscreen-lock">lock · {lockLine(lock) ?? "reading the lock state…"}</p>
    </div>
  );
}
