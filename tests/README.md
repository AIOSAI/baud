# tests/

**This directory holds no tests, and that is not an accident.** It used to say it was a
placeholder for a framework layout that never arrived, which made it a signpost pointing
at nothing. It now says where the tests actually are.

BAUD's tests live with their stack, because a test that does not sit beside the thing it
tests gets run by nobody.

| Stack | Where | How it is run |
| --- | --- | --- |
| Rust backend | `app/src-tauri/src/` — `#[cfg(test)]` modules in the file they test | `cargo test --locked` |
| TypeScript | *no test runner is installed* | `npx tsc --noEmit`, then `npm run build` and `npm run build:phone` |
| Python | *no surface* — `src/baud/baud/apps/baud.py` is the drone shim, not app code | — |

`.github/workflows/ci.yml` is the audit lane the robot runs: `npx tsc --noEmit`,
`npm run build`, `cargo test --locked`, `cargo clippy --all-targets --locked -- -D warnings`.

**The TypeScript side has no automated tests**, said plainly rather than left to be
discovered. What it has instead is the type-check, both bundle builds, and per-round
behaviour pins — small node scripts run against the compiled modules with a faked clock
or document, always alongside a control showing the old behaviour, and reported in the
round they belong to. Those are deliberately not stored here: a pin measures one round's
claim, and a drawer of stale pins would read like a suite while proving nothing.

If a frontend test runner is ever installed, it belongs in `app/` beside `package.json` —
not here. This directory stays for a Python surface that does not exist yet.
