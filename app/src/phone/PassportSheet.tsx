/**
 * The opened passport: `passport.json` as an identity document; every live fact is the card's.
 * Reference: docs/phone/card.md
 */

import { useEffect, useRef, useState } from "react";

import { readFileText } from "../host";
import type { BranchStatus } from "../types";
// Imported, not copied: the gold stamp and the certificate document must read one file.
import { CERTIFICATE_FILE } from "./Certificate";

const PASSPORT_FILE = ".trinity/passport.json";

interface Document {
  data: Record<string, unknown> | null;
  error: string | null;
}

const EMPTY: Document = { data: null, error: null };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface PassportSheetProps {
  branch: BranchStatus;
  /** Open this branch's `artifacts/`; the caller owns the browser. */
  onArtifacts: () => void;
  onClose: () => void;
}

export default function PassportSheet({ branch, onArtifacts, onClose }: PassportSheetProps) {
  const [passport, setPassport] = useState<Document>(EMPTY);
  // No error state by design: absent, refused, malformed or privilege-less all mean
  // NO STAMP, and a branch with no admin grant is the normal case.
  const [certificate, setCertificate] = useState<Record<string, unknown> | null>(null);
  const [fullId, setFullId] = useState<{ citizen: boolean; registry: boolean }>({
    citizen: false,
    registry: false,
  });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Every open re-reads. Keyed on the name, not the object: the poll hands down a fresh
  // card every tick.
  useEffect(() => {
    setPassport(EMPTY);
    setCertificate(null);
    // The project is NAMED: an unnamed one resolves under the seat and reads a same-named local agent.
    readFileText(`${branch.name}/${PASSPORT_FILE}`, branch.project)
      .then((read) => {
        if (!alive.current) return;
        try {
          setPassport({ data: JSON.parse(read.content) as Record<string, unknown>, error: null });
        } catch (err) {
          setPassport({ data: null, error: `passport.json is not readable JSON: ${message(err)}` });
        }
      })
      .catch((err) => {
        if (alive.current) setPassport({ data: null, error: message(err) });
      });
    readFileText(`${branch.name}/${CERTIFICATE_FILE}`, branch.project)
      .then((read) => {
        if (!alive.current) return;
        try {
          setCertificate(JSON.parse(read.content) as Record<string, unknown>);
        } catch {
          setCertificate(null);
        }
      })
      .catch(() => {
        // Most branches have no certificate; a 404 here is normal and never shown.
        if (alive.current) setCertificate(null);
      });
  }, [branch.name, branch.project]);

  const identity = (passport.data?.identity ?? {}) as Record<string, unknown>;
  const citizenship = (passport.data?.citizenship ?? {}) as Record<string, unknown>;
  const branchInfo = (passport.data?.branch_info ?? {}) as Record<string, unknown>;
  const principles = Array.isArray(passport.data?.principles)
    ? (passport.data?.principles as unknown[]).filter((each): each is string => typeof each === "string")
    : [];
  const line = (source: Record<string, unknown>, key: string): string | null =>
    typeof source[key] === "string" && source[key] !== "" ? (source[key] as string) : null;

  /** A field that is a string on most passports and a list on some (@devpulse's `traits`). */
  const lines = (source: Record<string, unknown>, key: string): string[] => {
    const held = source[key];
    if (typeof held === "string") return held === "" ? [] : [held];
    if (Array.isArray(held)) return held.filter((each): each is string => typeof each === "string" && each !== "");
    return [];
  };

  const traits = lines(identity, "traits");

  // The snapshot's copy of the same field stands in when the read is refused.
  const citizenClass = line(identity, "citizen_class") ?? branch.citizen_class;

  // citizen_id is the agent's own passport number; registry_id is the registry's id, which
  // every sibling shares by design. The serial is the first segment, upper-cased.
  const serialOf = (id: string | null): string | null =>
    id ? id.split("-")[0].toUpperCase() : null;
  const citizenId = line(citizenship, "citizen_id");
  const registryId = line(citizenship, "registry_id");

  // The admin grant stamps only on a signed `privileges` block on the birth certificate.
  const privileges = certificate?.privileges;
  const granted =
    typeof privileges === "object" && privileges !== null && !Array.isArray(privileges);
  const stamps: ReadonlyArray<{ label: string; gold?: boolean; hint: string }> = [
    ...(citizenClass === "manager"
      ? [{ label: "MANAGER", hint: "citizen class: manager — the project's owner" }]
      : []),
    ...(granted
      ? [
          {
            label: "ADMIN GRANT",
            gold: true,
            hint: "a signed privileges block on this branch's birth certificate",
          },
        ]
      : []),
  ];

  const fields: ReadonlyArray<{ label: string; value: string; list?: string[] }> = [
    { label: "Role", value: line(identity, "role") ?? "—" },
    { label: "Purpose", value: line(identity, "purpose") ?? "—" },
    {
      label: "Traits",
      value: traits.length === 0 ? "—" : traits.length === 1 ? traits[0] : "",
      list: traits.length > 1 ? traits : undefined,
    },
  ];

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop dismissal; every control inside is a real button.
    <div
      className="baud-pass-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="baud-pass" aria-label={`${branch.name} passport`}>
        <header className="baud-pass-title">
          <p className="baud-pass-issuer">AIPASS</p>
          <p className="baud-pass-type">AGENT PASSPORT</p>
          <button type="button" className="baud-pass-close" title="close the passport" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="baud-pass-body">
          {passport.error ? (
            <p className="baud-pass-refusal" role="alert">
              {passport.error}
            </p>
          ) : null}

          <div className="baud-pass-holder">
            <span className="baud-pass-photo" aria-hidden="true">
              {branch.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <p className="baud-pass-holder-name">{branch.name.toUpperCase()}</p>
              <p className="baud-pass-holder-class">
                citizen class · {citizenClass || "none declared"}
              </p>
            </div>
          </div>

          <dl className="baud-pass-fields">
            {fields.map((field) => (
              <div key={field.label} className="baud-pass-field">
                <dt>{field.label}</dt>
                {field.list ? (
                  <dd>
                    <ul className="baud-pass-field-list">
                      {field.list.map((each) => (
                        <li key={each}>{each}</li>
                      ))}
                    </ul>
                  </dd>
                ) : (
                  <dd>{field.value}</dd>
                )}
              </div>
            ))}
          </dl>

          <dl className="baud-pass-fieldrow">
            <div className="baud-pass-field">
              <dt>Issued</dt>
              <dd>{line(branchInfo, "created") ?? "—"}</dd>
            </div>
            <div className="baud-pass-field">
              <dt>Passport no.</dt>
              {/* A tap shows the whole id: a touch screen never shows the title. */}
              <dd
                className="baud-pass-serial"
                title={citizenId ?? "no citizen id on this passport yet — @spawn stamps it"}
              >
                {citizenId ? (
                  <button
                    type="button"
                    className="baud-pass-serial-door"
                    aria-label={fullId.citizen ? "show the short passport number" : "show the full citizen id"}
                    onClick={() => setFullId((was) => ({ ...was, citizen: !was.citizen }))}
                  >
                    {fullId.citizen ? citizenId : serialOf(citizenId)}
                  </button>
                ) : (
                  "UNISSUED"
                )}
              </dd>
            </div>
            <div className="baud-pass-field">
              <dt>Branch reg no.</dt>
              <dd className="baud-pass-serial" title={registryId ?? "no registry id on this passport"}>
                {registryId ? (
                  <button
                    type="button"
                    className="baud-pass-serial-door"
                    aria-label={fullId.registry ? "show the short registry number" : "show the full registry id"}
                    onClick={() => setFullId((was) => ({ ...was, registry: !was.registry }))}
                  >
                    {fullId.registry ? registryId : serialOf(registryId)}
                  </button>
                ) : (
                  "UNREGISTERED"
                )}
              </dd>
            </div>
          </dl>

          {principles.length > 0 ? (
            <ul className="baud-pass-principles">
              {principles.map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
          ) : null}

          {stamps.length > 0 ? (
            <div className="baud-pass-stamps">
              {stamps.map((stamp) => (
                <span
                  key={stamp.label}
                  className={`baud-pass-stamp ${stamp.gold ? "baud-pass-stamp-gold" : ""}`}
                  title={stamp.hint}
                >
                  {stamp.label}
                </span>
              ))}
            </div>
          ) : null}

          <div className="baud-pass-docdoor">
            <button
              type="button"
              className="baud-pass-door"
              title={`browse ${branch.name}'s artifacts — the signed records @spawn wrote`}
              onClick={onArtifacts}
            >
              artifacts — official records
            </button>
          </div>

          <p className="baud-pass-docnote">
            identity document only — everything live lives on the agent card
          </p>
        </div>
      </section>
    </div>
  );
}
