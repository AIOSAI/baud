#!/bin/sh
# BAUD install sandbox entrypoint: a container has no systemd, so tailscaled starts here, then the login shell.
set -e

mkdir -p /var/lib/tailscale
tailscaled --state=/var/lib/tailscale/tailscaled.state >/var/log/tailscaled.log 2>&1 &

# `su -` drops the container's environment, so AIPASS_SOURCE rides in through profile.d.
# Only the sandbox sets it; without it this is the public install.
if [ -n "${AIPASS_SOURCE:-}" ]; then
    printf 'export AIPASS_SOURCE=%s\n' "$AIPASS_SOURCE" > /etc/profile.d/aipass-sandbox.sh
fi

# Docker creates the --keep-logins volume root-owned; Claude Code's sign-in must write there.
if [ -d /home/ubuntu/.claude ]; then
    chown -R ubuntu:ubuntu /home/ubuntu/.claude
fi

exec su - ubuntu
