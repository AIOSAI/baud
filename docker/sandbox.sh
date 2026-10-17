#!/bin/sh
# BAUD install sandbox (DPLAN-0408) — the installer tested in minutes, not trains.
#
#   projects/baud/docker/sandbox.sh [--keep-logins] [--rebuild] [--name NAME]
#
# Builds the baud-sandbox image once (a stranger's Ubuntu: sudo, curl, a user,
# Tailscale; nothing the installer itself installs) and keeps it. Each run starts
# a fresh container from it with this checkout mounted read-only at /src/aipass
# and a stamped copy of the local install.sh at /src/baud/install.sh. Inside,
# paste the one line:
#
#   curl -fsSL file:///src/baud/install.sh | sh
#
# What crosses from the host is only what git holds: the aipass CLI is built from
# a clone of /src/aipass and `aipass install --source /src/aipass` clones it again
# into the home, so .venv, .trinity, docs.local, logs, secrets, untracked and
# uncommitted files cannot cross — the committed HEAD, exactly as GitHub would
# serve it. Commit, run, watch. The BAUD face still comes from the newest GitHub
# release (the face is not what these tests change).
#
#   --keep-logins   keep Tailscale and Claude Code sign-ins between runs
#                   (named volumes); the default is the stranger's fresh run
#   --rebuild       rebuild the image (new Ubuntu packages, a changed Dockerfile)
#   --name NAME     the container's name (default baud-sandbox-HHMMSS)
#
# The container is removed when its shell exits; the image stays.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd -P)
BAUD_ROOT=$(cd "$HERE/.." && pwd -P)
AIPASS_ROOT=$(cd "$BAUD_ROOT/../.." && pwd -P)
IMAGE=baud-sandbox
KEEP=""
REBUILD=""
NAME="baud-sandbox-$(date +%H%M%S)"

while [ $# -gt 0 ]; do
    case "$1" in
        --keep-logins) KEEP=1 ;;
        --rebuild) REBUILD=1 ;;
        --name) shift; NAME="${1:?--name needs a value}" ;;
        -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "sandbox.sh: unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done

[ -f "$AIPASS_ROOT/pyproject.toml" ] && [ -d "$AIPASS_ROOT/.git" ] \
    || { echo "sandbox.sh: no AIPass checkout two levels above projects/baud: $AIPASS_ROOT" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "sandbox.sh: docker is not on PATH" >&2; exit 2; }

if [ -n "$REBUILD" ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Building $IMAGE once (kept for every later run) ..."
    docker build -t "$IMAGE" "$HERE"
fi

# install.sh refuses to run unstamped: BAUD_TAG is the newest release, AIPASS_VERSION 'local' (the clone).
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/baud-sandbox.XXXXXX")
TAG=$(curl -fsSL https://api.github.com/repos/AIOSAI/baud/releases/latest 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$TAG" ] || { echo "sandbox.sh: could not read the newest BAUD release tag from GitHub (offline?)" >&2; exit 1; }
sed -e "s|@BAUD_TAG@|$TAG|" -e "s|@AIPASS_VERSION@|local|" "$BAUD_ROOT/install.sh" > "$SCRATCH/install.sh"

VOLS=""
if [ -n "$KEEP" ]; then
    VOLS="-v baud-sandbox-tailscale:/var/lib/tailscale -v baud-sandbox-claude:/home/ubuntu/.claude"
fi

echo "AIPass: $AIPASS_ROOT at its committed HEAD, by git clone. BAUD face: $TAG. Container: $NAME (removed on exit)."
echo
echo "Inside, paste:   curl -fsSL file:///src/baud/install.sh | sh"
echo

# shellcheck disable=SC2086  # VOLS is two -v pairs or empty, split on purpose
exec docker run -it --rm --name "$NAME" --hostname baud-sandbox \
    --cap-add=NET_ADMIN --device=/dev/net/tun \
    -v "$AIPASS_ROOT:/src/aipass:ro" -v "$SCRATCH:/src/baud:ro" \
    -e AIPASS_SOURCE=/src/aipass $VOLS "$IMAGE"
