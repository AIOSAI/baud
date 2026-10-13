# Development

Building BAUD, the checks every change runs, the palette as data, and the host seam.

## Development

Stack: Tauri 2 with `portable-pty` and `ashpd` on the Rust side; React 19,
xterm.js and CodeMirror 6 on the frontend; one plain stylesheet. BAUD's own
markup carries no inline styles — zero `style=` attributes across the entire
frontend, every colour read out of `theme.css`.

The CSP is not what enforces that, and the difference is worth one paragraph:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
`script-src` stays `'self'` with no exception — no inline scripts, no CDN, no
remote origin. `style-src` carries `'unsafe-inline'` for exactly one dependency:
xterm.js styles its own DOM at runtime (row metrics, cursor, theme) through inline
attributes and an injected `<style>` element, and without the exception the
terminal renders unusable. So the absence of inline styles in BAUD's markup is a
discipline the codebase keeps, not a wall the browser holds for it.

`app/src/types.ts` mirrors the Rust structs by hand. Change one, change the
other.

### The palette is data

`app/src/tokens/tokens.json` holds the 18 `--baud-*` values, and
`npm run tokens` generates `tokens.generated.css` from it — imported before
`theme.css`, which is written entirely in `var(--baud-*)` and defines no
colours of its own. The generator is dependency-free and deterministic, so a
regenerate either produces identical bytes or a real diff. `tokens/index.ts`
exports the same values as a typed object for a face that cannot read a
stylesheet. Edit the JSON; never the generated CSS. The terminal panes still
read their theme back out of the computed stylesheet, so there is still no
second palette anywhere.

### Every host call goes through the seam

`app/src/host/` is the only part of the frontend that knows how a call reaches
the machine. `transport.ts` holds the one `invoke` in the application;
`index.ts` gives each of the 26 backend commands a typed function. Components
import from `../host` and never from `@tauri-apps` — the two exceptions are
`App.tsx` and `Zoom.tsx`, which use `api/webview` for file-drop and window zoom,
genuine desktop-window concerns rather than host calls.

That second face now exists — see [The phone face](phone.md). The seam has two bindings and still no
runtime switch: a build picks one, and nothing above the seam can tell which.
