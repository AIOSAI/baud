/**
 * The opened passport, phone-shaped - and since compass #291, ONLY a passport.
 *
 * THE RULING THIS FILE IMPLEMENTS: the passport is a pure identity document -
 * `passport.json` rendered as a document and nothing else. Every live fact,
 * every count, every door and every verb lives on the agent card. One home per
 * fact; nothing renders twice.
 *
 * So this round is mostly a SUBTRACTION, and it is worth naming what left and
 * where it went, because none of it was deleted:
 *
 *   working memory  -> the card's `memory` door (MemoryScreen). Four tabs of
 *                      files the agent rewrites daily are the opposite of an
 *                      identity document; filing them inside one made the
 *                      document lie about what it was.
 *   monitors        -> the card's MANAGER zone. Operational doors, and a
 *                      passport has no operational doors.
 *   sub-agent count -> the card's own state line, where it already was. It was
 *                      being printed twice, and it is a live number.
 *   class           -> the holder block, beside the name, where a passport
 *                      prints it. It was a field in the list AND the answer to
 *                      the manager question the stamps now carry.
 *
 * WHAT IT KEEPS is the document: holder, role, purpose, traits, when it was
 * issued and under what number, the principles the agent declares, the stamps
 * it has earned, and one door to the official records behind it.
 *
 * EVERY PAGE IS READ, NOTHING IS OWNED - the desktop's rule, carried whole. The
 * files belong to @spawn and to the agent; BAUD renders them and writes nothing
 * back, so a read that fails says so in the HOST's own words rather than
 * drawing an empty document, which would read as an agent with nothing to say.
 *
 * NAMES, NEVER PATHS. The desk asks for `${branch.path}/.trinity/passport.json`
 * - an absolute path, which this face's transport refuses by design. The host
 * fence takes a branch NAME and a relative file, so that is what is passed,
 * with the project named beside it.
 */

import { useEffect, useRef, useState } from "react";

import { readFileText } from "../host";
import type { BranchStatus } from "../types";
/**
 * THE GRANT'S ONLY EVIDENCE. Not a field on the passport, not a flag in the
 * fleet read - the signed certificate @spawn wrote when the branch was born,
 * read through the same by-name lane as everything else on this face.
 *
 * The name now comes from the module that RENDERS that certificate as a
 * document (08-17), because this sheet's gold stamp and that document must be
 * talking about the same file forever - two copies of the string is how one of
 * them quietly starts reading somewhere else.
 */
import { CERTIFICATE_FILE } from "./Certificate";

/** The document, by the name the fence takes. */
const PASSPORT_FILE = ".trinity/passport.json";

/** One read file, parsed - or the reason it could not be. */
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
  /** Open this branch's `artifacts/` - the official records behind the
   *  document. The caller owns the browser, as it does for the files door. */
  onArtifacts: () => void;
  onClose: () => void;
}

export default function PassportSheet({ branch, onArtifacts, onClose }: PassportSheetProps) {
  const [passport, setPassport] = useState<Document>(EMPTY);
  /**
   * The birth certificate - and it is held as a plain value with NO error
   * state, which is the whole design of the gold stamp.
   *
   * A stamp is a claim of fact. There is exactly one shape that earns it: the
   * file exists, it parses, and it carries a `privileges` block. Absent,
   * unreadable, refused, malformed, or present-without-privileges are all the
   * same answer here - NO STAMP - and none of them is an error worth putting on
   * a document, because a branch with no admin grant is the normal case. The
   * honest absence IS the render.
   */
  const [certificate, setCertificate] = useState<Record<string, unknown> | null>(null);
  /** Which ids the operator tapped open to their full length (DPLAN-0414 A#14). */
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

  // Mounting IS opening, as at the desk: every open re-reads, so a passport can
  // never show a picture of a file that was rewritten while the sheet sat up.
  // Keyed on the NAME, not the object - the poll hands down a fresh card every
  // tick and re-reading on every one of those is a leak, not a policy.
  useEffect(() => {
    setPassport(EMPTY);
    setCertificate(null);
    // The project is NAMED, never inferred. Browsing is free across projects
    // now, and an unnamed project resolves under the seat - which for a foreign
    // card does not fail, it quietly reads a same-named local agent's document
    // and prints it under this agent's name.
    readFileText(`${branch.name}/${PASSPORT_FILE}`, branch.project)
      .then((read) => {
        if (!alive.current) return;
        try {
          setPassport({ data: JSON.parse(read.content) as Record<string, unknown>, error: null });
        } catch (err) {
          // A malformed passport is @spawn's news, not a BAUD fault.
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
          // Unparseable is not a grant. Nothing is said and nothing is guessed.
          setCertificate(null);
        }
      })
      .catch(() => {
        // Most branches have no certificate at all, and a 404 on this lane is
        // the normal answer. It is not news and it is never shown.
        if (alive.current) setCertificate(null);
      });
    // Both halves of the address, because either one changing means a different
    // agent's documents - two projects can carry the same branch name.
  }, [branch.name, branch.project]);

  const identity = (passport.data?.identity ?? {}) as Record<string, unknown>;
  const citizenship = (passport.data?.citizenship ?? {}) as Record<string, unknown>;
  const branchInfo = (passport.data?.branch_info ?? {}) as Record<string, unknown>;
  const principles = Array.isArray(passport.data?.principles)
    ? (passport.data?.principles as unknown[]).filter((each): each is string => typeof each === "string")
    : [];
  const line = (source: Record<string, unknown>, key: string): string | null =>
    typeof source[key] === "string" && source[key] !== "" ? (source[key] as string) : null;

  /**
   * A field that is a STRING on most passports and a LIST on some.
   *
   * Measured, not assumed: @devpulse's `traits` is a JSON array of six
   * sentences while every other branch I read carries a plain string. A
   * string-only reader renders that agent's Traits as an em-dash - a document
   * printing "nothing here" over a populated field, which is precisely the lie
   * this passport is not allowed to tell. So both shapes are read, and anything
   * that is neither still falls through to a stated absence.
   */
  const lines = (source: Record<string, unknown>, key: string): string[] => {
    const held = source[key];
    if (typeof held === "string") return held === "" ? [] : [held];
    if (Array.isArray(held)) return held.filter((each): each is string => typeof each === "string" && each !== "");
    return [];
  };

  const traits = lines(identity, "traits");

  // The class the FILE claims, falling back to the snapshot's copy of the same
  // field - when the read is refused the card's value is all there is, and it
  // is the same field read by a different lane, not a guess.
  const citizenClass = line(identity, "citizen_class") ?? branch.citizen_class;

  /**
   * TWO NUMBERS, TWO MEANINGS (Patrick's ruling, 2026-08-24).
   *
   * `citizenship.citizen_id` is the citizen's OWN unique id - minted in its
   * registry's branches[] entry, stamped into the passport by @spawn. That is
   * the PASSPORT NUMBER: no two agents share one.
   *
   * `citizenship.registry_id` is the id of the REGISTRY that holds the
   * citizen - AIPASS_REGISTRY's own metadata.id for the core fleet, each
   * project registry's for its own. Every passport in a registry carries the
   * same one BY DESIGN: it is the lock binding agent to branch registry. An
   * earlier reading of it as "18 duplicate passport numbers" was this sheet's
   * old label talking, not the data - the predecessor of this comment called
   * that a KNOWN DATA WART, and the wart was ours.
   *
   * A registry issues UUIDs; a document shows a serial. First segment upper
   * case, the WHOLE id on the title attribute and, since DPLAN-0414, one tap
   * on the serial away - shortened, never invented, nothing hidden from a
   * thumb.
   */
  const serialOf = (id: string | null): string | null =>
    id ? id.split("-")[0].toUpperCase() : null;
  const citizenId = line(citizenship, "citizen_id");
  const registryId = line(citizenship, "registry_id");

  /**
   * The stamps, and each one is a fact with a source.
   *
   *   MANAGER     - the passport's own `citizen_class`. The same field the
   *                 holder block prints, asked one question.
   *   ADMIN GRANT - a signed `privileges` block on the birth certificate, and
   *                 nothing else will do. No certificate, no privileges, no
   *                 stamp: an absent grant is silent, never guessed at, never
   *                 apologised for.
   */
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

  /** ORDER IS THE MOCK'S, field for field: what the holder is, then when the
   *  document was issued and under what number. */
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
        {/* THE TITLE BLOCK, real-passport order: who issued it, then what the
            document is. Whose it is belongs to the holder block below, where a
            passport prints the holder - it used to be printed here too, which
            was the same name in two places on one screen. */}
        <header className="baud-pass-title">
          <p className="baud-pass-issuer">AIPASS</p>
          <p className="baud-pass-type">AGENT PASSPORT</p>
          <button type="button" className="baud-pass-close" title="close the passport" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="baud-pass-body">
          {/* The host's sentence, not ours. This face's read lane really does
              refuse some branches, so this line is a working part of the
              document rather than a defensive branch nobody sees. */}
          {passport.error ? (
            <p className="baud-pass-refusal" role="alert">
              {passport.error}
            </p>
          ) : null}

          <div className="baud-pass-holder">
            {/* The wheel's own initials, at document scale - the same two
                letters the operator tapped to get here. */}
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

          {/* ISSUED, PASSPORT NO. and BRANCH REG NO. share the line, because
              that is the row on a real passport where short facts sit side by
              side. Passport no. is the citizen's unique id; Branch reg no. is
              the registry lock every sibling shares - two different numbers,
              and printing the shared one as "Passport no." was the mislabel
              this row used to carry. */}
          <dl className="baud-pass-fieldrow">
            <div className="baud-pass-field">
              <dt>Issued</dt>
              <dd>{line(branchInfo, "created") ?? "—"}</dd>
            </div>
            <div className="baud-pass-field">
              <dt>Passport no.</dt>
              {/* A TAP SHOWS THE WHOLE ID (DPLAN-0414 A#14). The serial is the
                  first segment and the full UUID rode only the title, which a
                  touch screen never shows - so "nothing hidden from a long
                  press" was true on a desk and false here. The short serial is
                  now a button that swaps to the full id and back. No id, no
                  button: UNISSUED has nothing behind it. The title stays. */}
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

          {/* RUBBER STAMPS, and the rotation is the point: a stamp is pressed
              by a hand, not laid out by a grid. Nothing renders here when the
              agent has earned nothing - an empty row would read as a document
              waiting for something to arrive. */}
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

          {/* THE ONE DOOR A DOCUMENT MAY HAVE: not an action, a reference - the
              official records this document was issued against. */}
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
