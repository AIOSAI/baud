/**
 * The birth certificate, drawn as a document; null hands the raw file back to the Reader.
 * Reference: docs/phone/card.md
 */

import type { ReactNode } from "react";

export const ARTIFACTS_DIR = "artifacts";

/** The passport's ADMIN GRANT stamp reads this same constant; never copy the string. */
export const CERTIFICATE_FILE = `${ARTIFACTS_DIR}/birth_certificate.json`;

/** Designed only when floored at `artifacts` and at the one name; anywhere else opens as text. */
export function isCertificateOpen(branch: string, floor: string, ref: string): boolean {
  return floor === ARTIFACTS_DIR && ref === `${branch}/${CERTIFICATE_FILE}`;
}

function objectFrom(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function text(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) return null;
  const held = source[key];
  return typeof held === "string" && held !== "" ? held : null;
}

/** The document, or null if this text is not one (the Reader then prints the file). */
export function renderCertificate(raw: string): ReactNode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = objectFrom(parsed);
  if (data === null) return null;

  /* `owner` first: `id` is the citizen number in this fleet, not the agent's name. */
  const name = text(data, "owner") ?? text(data, "id");
  if (name === null) return null;

  return <CertificateDocument data={data} name={name} />;
}

function privilegesOf(data: Record<string, unknown>): { names: string[]; by: string | null } | null {
  const held = objectFrom(data.privileges);
  if (held === null) return null;
  /* `admin: false` is a privilege explicitly NOT granted; never seal it. */
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
  name: string;
}

function CertificateDocument({ data, name }: CertificateDocumentProps) {
  const meta = objectFrom(data.metadata);
  const born = text(data, "created_at");
  const purpose = text(data, "description") ?? text(meta, "purpose");

  /* Built, not laid out: a cell with no value is left out, never printed empty. */
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
        <div className="baud-cert-inner">
          <p className="baud-cert-authority">AIPASS</p>
          <p className="baud-cert-doctype">CERTIFICATE OF BIRTH</p>

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

          {privileges ? (
            <div className="baud-cert-seal">
              <b>{privileges.names.join(" · ")}</b>
              {privileges.by ? <span>{privileges.by}</span> : null}
            </div>
          ) : null}

          {/* The whole hash, never shortened: a signature is evidence. */}
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
