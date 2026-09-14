## What changed

## How it was verified

The six checks, plus anything run beyond them:

- [ ] `cd app/src-tauri && cargo test --locked`
- [ ] `cd app/src-tauri && cargo clippy --all-targets --locked -- -D warnings`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm test`
- [ ] `cd app && npm run build`
- [ ] `cd app && npm run build:phone`

## Docs that moved

<!-- The README.md or MAP.md sentences this changes, and the line it adds under
     Unreleased in CHANGELOG.md. -->
