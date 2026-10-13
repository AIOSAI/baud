# Contributing to BAUD

BAUD is pre-release, built by a solo developer working with an AI team. Contributions are welcome.

## Before You Start

Open an issue first. Use the [issue templates](https://github.com/AIOSAI/baud/issues/new/choose) for bug reports or feature requests. This lets us discuss scope and approach before you write code.

An installed copy of BAUD is an appliance that tracks its branch. Contributing happens in your fork, not in an installed copy.

## Pull Requests

Fork the repo, branch off `dev`, and open the pull request against `dev`. Keep changes focused: one fix or feature per PR. Include tests where applicable.

**Target the `dev` branch.** `main` only receives tested release trains from `dev`. GitHub defaults a new PR to `main`; switch the base to `dev` when you open one.

BAUD is MIT licensed, matching [LICENSE](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.

## Development

BAUD is Rust (a Tauri 2 app in `app/src-tauri/`) and TypeScript (React, in `app/`). CI runs these checks, and a PR should pass them locally first.

In `app/`, on Node 22:

- `npm ci`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `npm run build:phone`

In `app/src-tauri/`, with tmux installed (two tests open real tmux sessions):

- `cargo test --locked`
- `cargo clippy --all-targets --locked -- -D warnings`
- `cargo build --release --locked --no-default-features --bin baud-cli`, then `ldd target/release/baud-cli` must show no GUI library (no libgtk, libwebkit, libjavascriptcore or libsoup)

## Questions?

Open an [issue](https://github.com/AIOSAI/baud/issues/new/choose) or start a discussion in an existing thread.
