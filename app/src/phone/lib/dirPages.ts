/** Paging one directory level through /v1/dir's `offset` and `total`; pure. A host without `total` would answer `offset` with the first page again, so it never pages. */

import type { DirEntryInfo, DirWindow } from "../../types";

export interface DirListing {
  entries: DirEntryInfo[];
  total?: number;
  more: boolean;
}

export function firstPage(got: DirWindow): DirListing {
  return { entries: got.entries, total: got.total, more: got.truncated };
}

/** Appended by path: an entry the folder shifted between pages must not show twice. */
export function withPage(listing: DirListing, got: DirWindow): DirListing {
  const seen = new Set(listing.entries.map((entry) => entry.path));
  const fresh = got.entries.filter((entry) => !seen.has(entry.path));
  // An empty page ends the listing even if `truncated` says otherwise: asking again would loop.
  return {
    entries: [...listing.entries, ...fresh],
    total: got.total ?? listing.total,
    more: got.truncated && fresh.length > 0,
  };
}

export function nextOffset(listing: DirListing): number | null {
  if (!listing.more || listing.total === undefined) return null;
  return listing.entries.length;
}

export function countLine(listing: DirListing): string | null {
  const shown = listing.entries.length;
  if (listing.total !== undefined && shown < listing.total) return `${shown} of ${listing.total} shown`;
  if (listing.total === undefined && listing.more) return `the first ${shown} shown - this host does not list further`;
  return null;
}

export function moreLabel(listing: DirListing): string {
  const left = listing.total === undefined ? 0 : listing.total - listing.entries.length;
  return left > 0 ? `show more (${left} left)` : "show more";
}
