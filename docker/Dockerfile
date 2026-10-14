# BAUD install sandbox (DPLAN-0408): a stranger's Ubuntu plus the four things a
# container lacks and a laptop has — sudo, curl, a user who may sudo, Tailscale
# installed (tailscaled is started by the entrypoint; there is no systemd here).
# Nothing else on purpose: git, tmux, uv, Claude Code and the aipass CLI are the
# installer's own rows, and preinstalling any of them would hide a row from the
# test. Built once by docker/sandbox.sh and kept; every run starts from it.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends sudo curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The image's user, as on a laptop: ubuntu:24.04 ships one named ubuntu (uid 1000).
RUN echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
 && chmod 0440 /etc/sudoers.d/ubuntu

# Tailscale's own installer, as the stranger would run it; sign-in happens at
# test time (install.sh runs tailscale up), never at build time.
RUN curl -fsSL https://tailscale.com/install.sh | sh \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/baud-sandbox-entrypoint
RUN chmod 0755 /usr/local/bin/baud-sandbox-entrypoint

ENTRYPOINT ["/usr/local/bin/baud-sandbox-entrypoint"]
