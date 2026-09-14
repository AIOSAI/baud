# Security

BAUD is a private, pre-release project. This page covers how its security works
today, what a token can reach, and how to report a problem.

## The model

**Security is tied to your own machine, and the tokens are the access right.**

- **BAUD runs on your own Linux machine.** The desktop app is a local window and
  opens no network port of its own.
- **The phone face is served only on your tailnet, by AIPass's host API.** The
  server binds exactly the address it was configured for, or refuses to start. It
  refuses wildcards (`0.0.0.0`, `::`), hostnames and any address the machine does
  not hold. The server has no TLS of its own; the tailnet's WireGuard encryption
  protects traffic on the wire, which is why nothing beyond the tailnet is
  supported.
- **No third party and no cloud sit in the path.** BAUD has no server, account or
  telemetry of its own. The phone talks to your machine over your tailnet, and to
  nothing else.
- **Each device gets its own bearer token, and you mint it.**
  `drone @api host-api issue-token <label> --scope read` (or `--scope operate`)
  creates one. The raw value is never printed. It lands in a receipt file that
  only you can read, by default `~/.secrets/aipass/host_api/<label>.token`, and
  the server keeps only a sha256 hash of it. The phone keeps the token in its
  browser's local storage until you sign out (gear, then sign out).
- **There are two scopes.** A `read` token can see the fleet, the feed, files,
  git, the machine's vitals and watch rooms. An `operate` token can also act: it
  runs verbs, uploads photos and opens a real terminal on the machine as your
  user.
- **A token reaches whatever that machine can read.** The file browser's roots
  include your home directory, with no deny list, so a read token can read
  `~/.ssh` and `~/.secrets`, and an operate token is a shell. Guard a token like
  an SSH key.
- **Revoke a token the moment a phone is lost.** `drone @api host-api list-tokens`
  shows every token without its value, along with where it was minted from (best
  effort), when it was last used and whether it is revoked.
  `drone @api host-api revoke-token <id>` takes effect on the next request, with
  no restart. A revoked token and an unknown one get the same refusal, and the
  server logs which of the two it was, along with the address that knocked.

## Supported versions

BAUD is on `0.x`. Fixes land on `main` and ship in the next release. Nothing is
backported.

## Reporting a vulnerability

Open an issue on this repository with `[security]` in the title. The repository is private, so only its collaborators can see it.
<!-- When the repository goes public, replace the line above with this one:
Do not open a public issue. Report it privately through GitHub's private vulnerability reporting: https://github.com/AIOSAI/baud/security/advisories/new
-->

Say what you did, what happened, and which BAUD build you are on. On the phone,
that is the gear, then **about**, then the **bundle** and **tree** rows. Leave
tokens out of the report.

There are no response-time promises. Reports are read and answered as the
maintainers can.

## This page will change

As of 2026-09-13, a dedicated security session is scheduled on the tokens and the
secrets folder (`~/.secrets`), including a trusted open-source secrets layer. The
home-directory reach described above will be revisited in that session, and this
page will change after it.
