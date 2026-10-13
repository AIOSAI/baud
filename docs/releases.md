# Versions and releases

How BAUD is versioned, what a release carries, and the one human step.

## Versions and releases

BAUD is versioned with semantic versioning. The current version is **0.3.1**,
declared in three files that must always agree — change one, change all three
(and `Cargo.lock` and `package-lock.json` record the same number, because CI
builds `--locked`):

```
app/package.json                  "version": "0.3.1"
app/src-tauri/Cargo.toml          version = "0.3.1"
app/src-tauri/tauri.conf.json     "version": "0.3.1"   <- what the built binary reports
```

While BAUD is pre-release the version stays on `0.x`, and the leading zero is
the honest part: the operator-facing surface can still move.

| bump | when |
| --- | --- |
| patch — `0.1.1` | a fix, or a change the operator cannot see |
| minor — `0.2.0` | a new operator-visible capability; a milestone landing is the usual trigger |
| major — `1.0.0` | breaking what the operator already relies on. `1.0.0` is also the going-public line |

**A release is the compatibility pin.** BAUD ships packaged with AIPass as one
unit, and that unit pulls the latest AIPass release. So the release — not a
version range in a manifest — is the statement of which BAUD and which AIPass
are known to work together (Patrick's ruling, 2026-08-12).

**Cutting a release is one human step.** Tags are `v<version>`, so this one is
`v0.3.1`, and pushing that tag is the whole ceremony — `.github/workflows/release.yml`
does the rest: it runs the test suite, builds with `npm run tauri build` (the
same command [Running it](desktop.md) calls the deploy), and publishes a GitHub
release named after the tag with `baud-v<version>-linux-x86_64` and a
`SHA256SUMS.txt` attached. Each release also carries the built phone bundle as
`baud-phone-v<version>.tar.gz`, the servable `dist-phone/` tree, with its sha256 in
the same `SHA256SUMS.txt`, and so does `baud-cli-v<version>-linux-x86_64`, the
headless binary (see [*The headless doors*](headless.md)). It tests before it ships on purpose: a tag can be
pointed at any commit, and "it was probably green on main" is not evidence.
Each release also carries `install.sh`, stamped with the tag and with the AIPass version in the root `AIPASS_VERSION` file, which the release playbook bumps with BAUD's own version.

@baud has no git write, so @devpulse pushes the tag.

What each release changed, and what is waiting for the next one, is in
[`CHANGELOG.md`](../CHANGELOG.md): every row that lands adds its line under Unreleased.
