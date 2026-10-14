# The install sandbox

Test the installer in minutes, not merge trains. A saved Docker image that is
already a stranger's machine; the local `install.sh`; the local AIPass checkout —
by `git clone`, so only committed files cross.

## The loop

```
projects/baud/docker/sandbox.sh          # from anywhere in the AIPass checkout
```

The first run builds the `baud-sandbox` image and keeps it (Ubuntu 24.04 with
sudo, curl, the `ubuntu` user allowed to sudo, Tailscale installed; `tailscaled`
starts with the container, since a container has no systemd). Every later run is
a `docker run` from that image: seconds. Inside, paste the one line:

```
curl -fsSL file:///src/baud/install.sh | sh
```

Same gesture as the public install, read through the same pipe-to-`sh` path
(`/dev/tty` and all). Watch it. When it ends, type `exit`; the container is
removed, the image stays.

Then: edit, **commit** (devpulse commits freely; the push waits), run
`sandbox.sh` again, paste, watch.

## What is local, what is not

| piece | comes from |
| --- | --- |
| `install.sh` | this checkout's `projects/baud/install.sh`, stamped by `sandbox.sh` (`BAUD_TAG` = the newest GitHub release, `AIPASS_VERSION` = `local`) |
| the aipass CLI | a `git clone` of this AIPass checkout, installed with uv or pipx |
| the AIPass home (`~/AIPass`) | `aipass install --source /src/aipass`: a second clone of the same checkout |
| the BAUD phone face and `baud-cli` | the newest GitHub release (the face is not what these tests change) |
| git, tmux, uv, Claude Code, the sign-ins | the installer's own rows, exactly as for a stranger |

The checkout is mounted read-only at `/src/aipass` and is never installed from
directly: everything that lands in the container passes through `git clone`, so
`.venv`, `.trinity/`, `docs.local/`, logs, `.secrets`, untracked files and
uncommitted edits cannot cross. What you test is the committed `HEAD`, exactly
as GitHub would serve it. An edit you have not committed is invisible on
purpose.

## Options

```
sandbox.sh --keep-logins   # keep the Tailscale and Claude Code sign-ins between runs
sandbox.sh --rebuild       # rebuild the image (new Ubuntu packages, a changed Dockerfile)
sandbox.sh --name NAME     # name the container (default baud-sandbox-HHMMSS)
```

`--keep-logins` mounts two named volumes (`baud-sandbox-tailscale`,
`baud-sandbox-claude`); the default is the stranger's run with both sign-ins.

## What the sandbox cannot see

The PyPI wheel itself (its pin, its contents) and the GitHub release stamping of
`install.sh`. Those stay the merge train's. Everything in `install.sh`, setup.sh,
`aipass install` and the phone step is the sandbox's, which is where the three
releases of 2026-10-13 went.

## Needs

Docker on the host, with `--cap-add=NET_ADMIN --device=/dev/net/tun` allowed
(kernel-mode Tailscale, so the host API can bind the tailnet address). Internet,
for the installer's own rows and the BAUD release.
