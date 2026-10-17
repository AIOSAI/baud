# BAUD

```sh
curl -fsSL https://github.com/AIOSAI/baud/releases/latest/download/install.sh | sh
```

**Your AI agents, on your phone, served from your own machine.** BAUD is the face of a fleet of persistent Claude Code agents running on your Linux box: you see who is working, open their rooms, type into them, and watch the machine, all from your phone's browser. Persistent AI by default.

## What you get

- **The wheel:** every agent in one flick, with live state, mail and memory.
- **Rooms:** an agent's live terminal session; read it, type into it, send it a photo.
- **The machine:** CPU, memory, disks, temperature, fans, network, processes and battery, live.

## How it works

Your machine serves the phone face over your own [Tailscale](https://tailscale.com) network. You scan a QR the machine shows, once, and the phone signs itself in. Nothing passes through our servers, because there are none: no account, no cloud, no telemetry.

## What it needs

- Linux on x86_64.
- git, tmux, curl and Python 3.10 or newer.
- [Claude Code](https://claude.com/claude-code), signed in to your Anthropic account.
- Tailscale on the machine and on the phone.

The installer checks each one and offers to install whatever is missing, one at a time, asking first. It names `sudo` wherever it needs it.

## Install

The line at the top installs into `~/AIPass`. To put AIPass under another folder, name the parent:

```sh
curl -fsSL https://github.com/AIOSAI/baud/releases/latest/download/install.sh | sh -s -- ~/Projects
```

The careful path is to read the script and check its sum before running it:

```sh
curl -fsSLO https://github.com/AIOSAI/baud/releases/latest/download/install.sh
curl -fsSLO https://github.com/AIOSAI/baud/releases/latest/download/SHA256SUMS.txt
sha256sum -c --ignore-missing SHA256SUMS.txt
sh install.sh
```

The script prints what the machine has, lists what is missing and installs all of it after one Enter, installs the `aipass` CLI from PyPI, and runs `aipass install`. That step clones AIPass and lands this release's phone face. The script never overwrites an existing `AIPass` folder, and [docs/uninstall.md](docs/uninstall.md) says how to undo everything it did.

## First run on your phone

The installer ends by asking you to press Enter when your phone's camera is ready, then shows a QR code. Point your phone's camera at it, tap the link, and the phone signs itself in. The code works once, for five minutes; `drone @api host-api pair phone --scope operate` makes a fresh one. The step-by-step guide for Android is [docs/phone-setup-android.md](docs/phone-setup-android.md).

## Security

A token is the access right. A `read` token sees what your machine can read; an `operate` token is a shell as your user. Guard a token like an SSH key, give each device its own, and revoke a token the moment a phone is lost. [SECURITY.md](SECURITY.md) has the full model and how to report a problem.

## Status

Pre-release, `0.x`. Linux only, and the surface still moves. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Built with AIPass

Most of what runs is [AIPass](https://github.com/AIOSAI/AIPass): the agents' identities, memory, mail, the plans and the host API that serves this face. BAUD is the face.

## Docs

- [The phone face](docs/phone.md): the wheel, rooms, files, git and the monitor row, and why each works the way it does.
- [The desktop window](docs/desktop.md): BAUD's Tauri app for the machine itself.
- [The headless doors](docs/headless.md): `baud-cli` and the same answers without a window.
- [Architecture](docs/architecture.md): how BAUD reads the fleet, and its three rules.
- [Development](docs/development.md): building, the palette, the host seam, and the checks.
- [The install sandbox](docs/sandbox.md): the installer tested in minutes — a saved Docker image, the local script, the local checkout by `git clone`.
- [Releases](docs/releases.md): versions, and what a release carries.
- [CHANGELOG.md](CHANGELOG.md): what changed, release by release.
- [MAP.md](MAP.md): where every file lives.

## Contributing

Fork the repo, branch off `dev`, and open a pull request against `dev`. An installed copy is an appliance that tracks its branch; contributing happens in your fork. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. See [LICENSE](LICENSE).
