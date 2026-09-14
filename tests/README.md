# tests/

**This directory holds no tests, and that is not an accident.** It used to say it was a
placeholder for a framework layout that never arrived, which made it a signpost pointing
at nothing. It now says where the tests actually are.

BAUD's tests live with their stack, because a test that does not sit beside the thing it
tests gets run by nobody.

| Stack | Where | How it is run |
| --- | --- | --- |
| Rust backend | `app/src-tauri/src/` — `#[cfg(test)]` modules in the file they test | `cargo test --locked` |
| TypeScript | `app/src/` — `*.test.ts` beside the module they pin (vitest) | `npm test`, beside `npx tsc --noEmit`, `npm run build` and `npm run build:phone` |
| Python | *no surface* — `src/baud/baud/apps/baud.py` is the drone shim, not app code | — |

`.github/workflows/ci.yml` is the audit lane the robot runs: `npx tsc --noEmit`,
`npm test`, `npm run build`, `npm run build:phone`, `cargo test --locked`,
`cargo clippy --all-targets --locked -- -D warnings`.

**The TypeScript tests cover pure functions only**: the lock and monitor face
derivations, the delivery quoting and the copy path - no DOM, no network, no faked
clock. Everything that renders or talks to the host is proven instead by the type-check,
both bundle builds, and per-round behaviour pins — small node scripts run against the compiled modules with a faked clock
or document, always alongside a control showing the old behaviour, and reported in the
round they belong to. Those are deliberately not stored here: a pin measures one round's
claim, and a drawer of stale pins would read like a suite while proving nothing.

The runner, vitest, is installed in `app/` beside `package.json`, and its tests sit beside
their modules — not here. This directory stays for a Python surface that does not exist yet.
