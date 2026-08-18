/**
 * THE BIRTH CERTIFICATE, rendered as the document it is (mock 08-17, approved).
 *
 * Every other file on this face opens in the Reader as text, and that is right:
 * BAUD does not know what a report or a plan means. It DOES know what a birth
 * certificate means - @spawn writes exactly one of them, at exactly one name,
 * with a shape that has not changed in five months - so the one file in the
 * fleet that is a DOCUMENT gets drawn as one.
 *
 * THE HONEST-ABSENCE RULE, which is the whole design: a field that is not in the
 * file renders NOTHING. No "N/A", no "unknown", no placeholder box waiting to be
 * filled. A certificate with no privileges block has no seal - most of the fleet
 * has none, and a greyed-out seal would read as a grant that was revoked.
 *
 * AND THE REFUSAL: `renderCertificate` returns null the moment the text is not a
 * JSON object, and the Reader then prints the raw file exactly as it does for
 * everything else. That is not an error path - the raw text IS the honest render
 * of a file that does not carry a certificate, and drawing a framed document
 * around nothing would be the face inventing a record. Measured, not theorised:
 * of the 16 birth certificates in this repo, @memory's is ZERO BYTES and three
 * more (@commons, @flow, @skills) are literally `{}`.
 */

import type { ReactNode } from "react";

/** The floor the passport's records door browses at. */
export const ARTIFACTS_DIR = "artifacts";

/**
 * The certificate, by the name the host's fence takes - relative to the branch
 * root, never a path. ONE constant for the whole face: the passport's gold
 * ADMIN GRANT stamp reads this same file to decide whether it exists, and a
 * second copy of this string is how the stamp and the document drift apart.
 */
export const CERTIFICATE_FILE = `${ARTIFACTS_DIR}/birth_certificate.json`;

/**
 * THE TRIGGER, in one place so it can be read and disproved.
 *
 * Two conditions, both required. The browse must be FLOORED AT `artifacts` -
 * i.e. it is the passport's records door and not the card's general files door -
 * and the file must be the one certificate at its one name. A
 * `birth_certificate.json` found anywhere else opens as text, because a designed
 * document is a claim about provenance and the only provenance this face knows
 * is "@spawn wrote it here, when the branch was born".
 */
export function isCertificateOpen(branch: string, floor: string, ref: string): boolean {
  return floor === ARTIFACTS_DIR && ref === `${branch}/${CERTIFICATE_FILE}`;
}

/** A JSON object, or null for anything else - text that will not parse, and
 *  also `[]`, `"x"`, `42`, `null`, all of which parse and none of which is a
 *  document. */
function objectFrom(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** A non-empty string field, or null. Absent and empty are the same answer:
 *  nothing to print. */
function text(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) return null;
  const held = source[key];
  return typeof held === "string" && held !== "" ? held : null;
}

/**
 * The document, or null if this text is not one.
 *
 * Handed to the Reader as its optional designed render; null means "I decline",
 * and the Reader prints the file. The Reader itself knows nothing about
 * certificates, which is why the other ~all files on this face cannot be
 * affected by anything in this module.
 */
export function renderCertificate(raw: string): ReactNode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON. Not an error - a file that is not a certificate is just a file.
    return null;
  }
  const data = objectFrom(parsed);
  if (data === null) return null;

  /**
   * WHO IT CERTIFIES, and the field order here is a measured correction to the
   * brief's `id ?? owner`.
   *
   * `id` is NOT the agent's name in this fleet. Read across all 12 populated
   * certificates: @api's id is `"0"`, @spawn's is `"7087bb93"` - it is the
   * citizen number, the same value as `metadata.citizen_number`, and only
   * @devpulse's happens to equal its own name. `owner` carries the name in every
   * one of the 12. Taking `id` first would print a certificate reading
   * "7087BB93 was born into the AIPass fleet", which is a designed lie about the
   * one thing this document exists to say. So: owner, then id as the fallback
   * for a certificate written by some other hand.
   */
  const name = text(data, "owner") ?? text(data, "id");
  /**
   * NO NAME, NO DOCUMENT. `{}` is object-shaped and three real certificates in
   * this repo are exactly that - a frame printing "this certifies that" over an
   * empty line certifies nothing, and it would be the face's own copy, not the
   * file's. The raw `{}` in the Reader is the truthful render of an empty file.
   */
  if (name === null) return null;

  return <CertificateDocument data={data} name={name} />;
}

/** The privilege seal's contents, once - names and the grant line. */
function privilegesOf(data: Record<string, unknown>): { names: string[]; by: string | null } | null {
  const held = objectFrom(data.privileges);
  if (held === null) return null;
  /* A privilege is a key that is not the grant's own bookkeeping and whose
     value is not falsy. `admin: false` is a privilege explicitly NOT granted
     and must never be sealed as one - that is the case worth being strict
     about. */
  const names = Object.keys(held)
    .filter((key) => key !== "granted_by" && key !== "granted")
    .filter((key) => Boolean(held[key]))
    .map((key) => key.toUpperCase());
  if (names.length === 0) return null;
  const grantedBy = text(held, "granted_by");
  const granted = text(held, "granted");
  const parts = [grantedBy ? `granted by ${grantedBy}` : null, granted].filter(
    (part): part is string => part !== null,
  );
  return { names, by: parts.length > 0 ? parts.join(" · ") : null };
}

interface CertificateDocumentProps {
  data: Record<string, unknown>;
  /** Already resolved by `renderCertificate` - it is what gates the render. */
  name: string;
}

function CertificateDocument({ data, name }: CertificateDocumentProps) {
  const meta = objectFrom(data.metadata);
  const born = text(data, "created_at");
  /* The purpose line: the certificate's own sentence, or the one @spawn filed
     under metadata when it wrote no description. */
  const purpose = text(data, "description") ?? text(meta, "purpose");

  /* THE ROW IS BUILT, NOT LAID OUT, because `metadata.template` is missing on
     half the fleet's certificates (the older ones carry `citizen_class`
     instead). An empty TEMPLATE column with a label over nothing is the exact
     placeholder this document is not allowed to print, so a cell with no value
     is not in the row at all. */
  const cells: ReadonlyArray<{ label: string; value: string }> = [
    { label: "CREATOR", value: text(data, "creator") },
    { label: "TEMPLATE", value: text(meta, "template") },
    { label: "RARITY", value: text(data, "rarity") },
  ].filter((cell): cell is { label: string; value: string } => cell.value !== null);

  const privileges = privilegesOf(data);
  const signature = objectFrom(data.signature);
  const algo = text(signature, "algo");
  const hash = text(signature, "value");

  return (
    <div className="baud-cert-body">
      <section className="baud-cert" aria-label={`${name} birth certificate`}>
        {/* THE DOUBLE RULE - a border and an outline offset from it. Two lines
            around a document is the oldest signal in print for "this is a
            certificate", and it costs one property. */}
        <div className="baud-cert-inner">
          <p className="baud-cert-authority">AIPASS</p>
          <p className="baud-cert-doctype">CERTIFICATE OF BIRTH</p>

          {/* THE CONNECTIVE LINES ARE TIED TO THEIR VALUES. "this certifies
              that" over an empty name is the face talking, not the file. */}
          <p className="baud-cert-certifies">this certifies that</p>
          <p className="baud-cert-name">{name.toUpperCase()}</p>
          {born ? (
            <>
              <p className="baud-cert-born">was born into the AIPass fleet on</p>
              <p className="baud-cert-date">{born}</p>
            </>
          ) : null}

          {purpose ? <p className="baud-cert-purpose">{purpose}</p> : null}

          {cells.length > 0 ? (
            <dl className="baud-cert-row">
              {cells.map((cell) => (
                <div key={cell.label} className="baud-cert-cell">
                  <dt>{cell.label}</dt>
                  <dd>{cell.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* THE SEAL, and only for a real grant. Rotated like the passport's
              stamps and for the same reason: a seal is pressed by a hand. */}
          {privileges ? (
            <div className="baud-cert-seal">
              <b>{privileges.names.join(" · ")}</b>
              {privileges.by ? <span>{privileges.by}</span> : null}
            </div>
          ) : null}

          {/* THE SIGNATURE. The whole hash, small and dim and wrapped - a
              signature is evidence, and evidence that has been shortened for
              looks is no longer evidence. */}
          {algo || hash ? (
            <div className="baud-cert-sig">
              <p className="baud-cert-sig-label">SIGNED</p>
              {algo ? <p className="baud-cert-sig-algo">{algo}</p> : null}
              {hash ? <p className="baud-cert-sig-hash">{hash}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
