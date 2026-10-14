#!/bin/sh
# BAUD install sandbox entrypoint (DPLAN-0408). A container has no systemd, so
# tailscaled starts here, the way the owner's test 13 started it by hand; then
# the stranger's login shell, where the one line is pasted.
set -e

mkdir -p /var/lib/tailscale
tailscaled --state=/var/lib/tailscale/tailscaled.state >/var/log/tailscaled.log 2>&1 &

# `su -` is a login shell and drops the container's environment, so the pointer
# to the local AIPass checkout rides in through profile.d instead. Only the
# sandbox sets it; a run without it is the public install, PyPI and GitHub.
if [ -n "${AIPASS_SOURCE:-}" ]; then
    printf 'export AIPASS_SOURCE=%s\n' "$AIPASS_SOURCE" > /etc/profile.d/aipass-sandbox.sh
fi

# --keep-logins mounts a named volume at ~/.claude; Docker creates it root-owned,
# and Claude Code's sign-in must be able to write there.
if [ -d /home/ubuntu/.claude ]; then
    chown -R ubuntu:ubuntu /home/ubuntu/.claude
fi

exec su - ubuntu
