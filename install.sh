#!/bin/sh
# BAUD installer - your AI agents on your phone, served from your own machine.
#
#   curl -fsSL https://github.com/AIOSAI/baud/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- ~/Projects     (installs to ~/Projects/AIPass)
#
# Nothing installs before you press Enter: it checks this machine, lists what is missing,
# installs it, runs `aipass install`, then shows the phone pairing QR. Re-running resumes.
#
# The careful path - check the script before running it:
#   curl -fsSLO https://github.com/AIOSAI/baud/releases/latest/download/install.sh
#   curl -fsSLO https://github.com/AIOSAI/baud/releases/latest/download/SHA256SUMS.txt
#   sha256sum -c --ignore-missing SHA256SUMS.txt
#   sh install.sh [parent-directory]
#
# release.yml stamps these two lines at pack time; the unstamped source refuses to run.
BAUD_TAG="@BAUD_TAG@"
AIPASS_VERSION="@AIPASS_VERSION@"

PYTHON_FLOOR_MAJOR=3
PYTHON_FLOOR_MINOR=10
CLAUDE_INSTALLER="https://claude.ai/install.sh"
TAILSCALE_INSTALLER="https://tailscale.com/install.sh"
UV_INSTALLER="https://astral.sh/uv/install.sh"
GUIDE_URL="https://github.com/AIOSAI/baud/blob/main/docs/phone-setup-android.md"
UNDO_URL="https://github.com/AIOSAI/baud/blob/main/docs/uninstall.md"

# Everything lives in functions and main runs on the last line, so a download
# cut off halfway runs nothing at all.

say() { printf '%s\n' "$*"; }
fail() {
    printf 'install.sh: %s\n' "$*" >&2
    exit 1
}

# Every pause reads from the terminal, not stdin: stdin is this script when
# it is piped from curl.
has_tty() { (: </dev/tty) 2>/dev/null; }

have() { command -v "$1" >/dev/null 2>&1; }

# apt needs root; name sudo rather than hide it.
as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif have sudo; then
        say "  running with sudo: $*"
        sudo "$@"
    else
        fail "'$*' needs root and sudo is not installed; run it as root, then run this script again"
    fi
}

# Claude Code, uv and pipx land in ~/.local/bin, which a fresh shell may not have on PATH.
PATH="$HOME/.local/bin:$PATH"
export PATH


STATE_platform=""
STATE_git=""
STATE_tmux=""
STATE_curl=""
STATE_sha256=""
STATE_python=""
STATE_pyinstaller=""
STATE_claude=""
STATE_claude_auth=""
STATE_tailscale=""
STATE_tailscale_up=""

python_ok() {
    python3 -c "import sys; sys.exit(0 if sys.version_info >= ($PYTHON_FLOOR_MAJOR, $PYTHON_FLOOR_MINOR) else 1)" 2>/dev/null
}

claude_signed_in() {
    claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'
}

tailscale_running() {
    tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'
}

check_all() {
    if [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]; then STATE_platform=ok; else STATE_platform=unsupported; fi
    for tool in git tmux curl; do
        if have "$tool"; then eval "STATE_$tool=ok"; else eval "STATE_$tool=missing"; fi
    done
    if have sha256sum || have shasum; then STATE_sha256=ok; else STATE_sha256=missing; fi
    if ! have python3; then STATE_python=missing; elif python_ok; then STATE_python=ok; else STATE_python="too old"; fi
    if have pipx || have uv; then STATE_pyinstaller=ok; else STATE_pyinstaller=missing; fi
    if ! have claude; then
        STATE_claude=missing
        STATE_claude_auth=missing
    else
        STATE_claude=ok
        if claude_signed_in; then STATE_claude_auth=ok; else STATE_claude_auth="signed out"; fi
    fi
    if ! have tailscale; then
        STATE_tailscale=missing
        STATE_tailscale_up=missing
    else
        STATE_tailscale=ok
        if tailscale_running; then STATE_tailscale_up=ok; else STATE_tailscale_up="not up"; fi
    fi
}

row() { printf '  %-28s %s\n' "$1" "$2"; }

print_table() {
    say ""
    say "BAUD $BAUD_TAG - what this machine has"
    row "linux x86_64" "$STATE_platform"
    row "git" "$STATE_git"
    row "tmux" "$STATE_tmux"
    row "curl" "$STATE_curl"
    row "sha256sum" "$STATE_sha256"
    row "python3 >= $PYTHON_FLOOR_MAJOR.$PYTHON_FLOOR_MINOR" "$STATE_python"
    row "pipx or uv" "$STATE_pyinstaller"
    row "Claude Code" "$STATE_claude"
    row "Claude Code signed in" "$STATE_claude_auth"
    row "Tailscale" "$STATE_tailscale"
    row "Tailscale connected" "$STATE_tailscale_up"
    say ""
}


APT_UPDATED=""

# DEBIAN_FRONTEND keeps packages like tzdata from asking on the terminal; env
# carries it through sudo, which drops the caller's environment.
apt_install() {
    have apt-get || fail "$1 is missing and this is not an apt system; install $1 with your package manager, then run this script again"
    if [ -z "$APT_UPDATED" ]; then
        as_root env DEBIAN_FRONTEND=noninteractive apt-get update
        APT_UPDATED=1
    fi
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

apt_row() {
    [ "$1" = missing ] || return 0
    apt_install "$2"
}

# What no install can fix stops before the one pause.
stop_on_uninstallable() {
    if [ "$STATE_platform" != ok ]; then
        fail "BAUD runs on Linux x86_64 only for now; this machine is $(uname -s) $(uname -m)"
    fi
    if [ "$STATE_python" = "too old" ]; then
        fail "python3 is $(python3 -c 'import sys; print(sys.version.split()[0])'); AIPass needs $PYTHON_FLOOR_MAJOR.$PYTHON_FLOOR_MINOR or newer, and this script will not replace your system python"
    fi
}

print_plan() {
    PLAN_MISSING=""
    PLAN_CLAUDE=""
    PLAN_TAILSCALE=""
    for state in "$STATE_git" "$STATE_tmux" "$STATE_curl" "$STATE_sha256" "$STATE_python" "$STATE_pyinstaller" "$STATE_claude" "$STATE_tailscale"; do
        [ "$state" = missing ] && PLAN_MISSING=1
    done
    have aipass || PLAN_MISSING=1
    [ "$STATE_claude_auth" = ok ] || PLAN_CLAUDE=1
    [ "$STATE_tailscale_up" = ok ] || PLAN_TAILSCALE=1
    if [ -z "$PLAN_MISSING$PLAN_CLAUDE$PLAN_TAILSCALE" ]; then
        say "Nothing to install. AIPass and the BAUD phone face will land in $HOME_DIR."
        say "Press Enter to start, Ctrl-C to stop."
        return 0
    fi
    say "BAUD $BAUD_TAG will install into $HOME_DIR."
    say "This will install:"
    [ "$STATE_git" = missing ] && say "  git (apt, with sudo)"
    [ "$STATE_tmux" = missing ] && say "  tmux (apt, with sudo)"
    [ "$STATE_curl" = missing ] && say "  curl (apt, with sudo)"
    [ "$STATE_sha256" = missing ] && say "  coreutils (apt, with sudo)"
    [ "$STATE_python" = missing ] && say "  python3 and python3-venv (apt, with sudo)"
    [ "$STATE_pyinstaller" = missing ] && say "  uv (uv's installer, into ~/.local/bin)"
    [ "$STATE_claude" = missing ] && say "  Claude Code (Anthropic's installer)"
    [ "$STATE_tailscale" = missing ] && say "  Tailscale (Tailscale's installer, with sudo)"
    if ! have aipass; then
        if [ -n "${AIPASS_SOURCE:-}" ]; then
            say "  the aipass CLI from $AIPASS_SOURCE (uv or pipx; a clone of its committed HEAD — the sandbox)"
        else
            say "  the aipass CLI $AIPASS_VERSION (uv or pipx, from PyPI)"
        fi
    fi
    say "  AIPass and the BAUD phone face into $HOME_DIR"
    if [ -n "$PLAN_CLAUDE" ] && [ -n "$PLAN_TAILSCALE" ]; then
        say "Then two sign-ins run: Claude Code (Anthropic's own sign-in) and Tailscale (it prints a link)."
    elif [ -n "$PLAN_CLAUDE" ]; then
        say "Then one sign-in runs: Claude Code (Anthropic's own sign-in)."
    elif [ -n "$PLAN_TAILSCALE" ]; then
        say "Then one sign-in runs: Tailscale (it prints a link)."
    fi
    say "Press Enter to start, Ctrl-C to stop. Nothing changes until Enter."
}

install_missing() {
    apt_row "$STATE_git" git
    apt_row "$STATE_tmux" tmux
    apt_row "$STATE_curl" curl
    if [ "$STATE_sha256" = missing ]; then
        apt_install coreutils
    fi
    if [ "$STATE_python" = missing ]; then
        apt_install python3 python3-venv
        python_ok || fail "apt's python3 is older than $PYTHON_FLOOR_MAJOR.$PYTHON_FLOOR_MINOR; install a newer python3, then run this script again"
    fi
    if [ "$STATE_pyinstaller" = missing ]; then
        say "Installing uv (Astral's own installer, into ~/.local/bin, no sudo)"
        curl -LsSf "$UV_INSTALLER" | sh
        have uv || fail "uv's installer finished but uv is not on PATH"
    fi
    if [ "$STATE_claude" = missing ]; then
        say "Installing Claude Code (Anthropic's own installer)"
        curl -fsSL "$CLAUDE_INSTALLER" | bash
        have claude || fail "Claude Code's installer finished but claude is not on PATH"
    fi
    CLAUDE_SIGNIN_SKIPPED=""
    if ! claude_signed_in; then
        say "Claude Code needs you signed in. Anthropic's own sign-in runs now;"
        say "this script never sees your credentials."
        if ! claude auth login </dev/tty >/dev/tty 2>&1 || ! claude_signed_in; then
            say "The Claude Code sign-in did not finish; going on without it."
            CLAUDE_SIGNIN_SKIPPED=1
        fi
    fi
    TAILSCALE_NOT_UP=""
    if [ "$STATE_tailscale" = missing ]; then
        say "Installing Tailscale (its own installer, uses sudo)"
        curl -fsSL "$TAILSCALE_INSTALLER" | sh
    fi
    if ! tailscale_running; then
        say "Tailscale prints a sign-in link: open it, sign in, and come back."
        if ! (as_root tailscale up </dev/tty >/dev/tty 2>&1); then
            say "tailscale up did not finish; to connect this machine later, run: sudo tailscale up"
            TAILSCALE_NOT_UP=1
        fi
    fi
}


install_aipass_cli() {
    if have aipass; then
        say "aipass is already installed ($(aipass --version 2>/dev/null || say unknown version)); leaving it as it is."
        say "  this release was built with aipass $AIPASS_VERSION"
        return 0
    fi
    if [ -n "${AIPASS_SOURCE:-}" ]; then
        # The sandbox points this at a local checkout. Build from a CLONE of it, so only
        # committed files cross, as GitHub would serve them.
        src_clone="$(mktemp -d "${TMPDIR:-/tmp}/aipass-src.XXXXXX")/aipass"
        say "Installing aipass from $AIPASS_SOURCE (a clone of its committed HEAD)"
        git clone --quiet "$AIPASS_SOURCE" "$src_clone" || fail "could not clone $AIPASS_SOURCE; stopping here, and what was already installed stays"
        if have pipx; then
            pipx install "$src_clone" || fail "pipx could not install aipass from $AIPASS_SOURCE; stopping here, and what was already installed stays"
        else
            uv tool install "$src_clone" || fail "uv could not install aipass from $AIPASS_SOURCE; stopping here, and what was already installed stays"
        fi
    elif have pipx; then
        say "Installing aipass $AIPASS_VERSION with pipx"
        pipx install "aipass==$AIPASS_VERSION" || fail "pipx could not install aipass $AIPASS_VERSION; stopping here, and what was already installed stays"
    else
        say "Installing aipass $AIPASS_VERSION with uv"
        uv tool install "aipass==$AIPASS_VERSION" || fail "uv could not install aipass $AIPASS_VERSION; stopping here, and what was already installed stays"
    fi
    have aipass || fail "aipass installed but is not on PATH"
    INSTALLED_CLI=1
}

print_undo() {
    say ""
    say "To undo:"
    if have pipx && pipx list --short 2>/dev/null | grep -q '^aipass '; then
        say "  pipx uninstall aipass"
    else
        say "  uv tool uninstall aipass"
    fi
    say "  rm -rf \"$HOME_DIR\"           # the AIPass home"
    say "  rm -rf \"$HOME/.aipass/baud\"  # the phone face and baud-cli"
    say "  sudo rm /usr/local/bin/aipass /usr/local/bin/drone  # the global command links"
    say "  in ~/.bashrc, delete the '# AIPass — cross-project access' lines (export AIPASS_HOME=...)"
    say "    and the block from '# >>> AIPass boot shim >>>' to '# <<< AIPass boot shim <<<' (also in ~/.zshrc, if you have one)"
    say "  in ~/.claude/settings.json, remove the AIPass hooks, the AIPASS_HOME env entry, the permission rules and the includeGitInstructions value setup.sh added"
    say "  rm \"$HOME/.claude/commands/memo.md\"  # the /memo command setup.sh added"
    say "  rm -rf \"$HOME/.secrets/aipass\"  # the .env for API keys"
    say "  rm \"$HOME/.aipass/trusted_projects.json\"  # the hook trust registry"
    say "Claude Code, Tailscale and apt packages stay; remove them with their own tools."
}

main() {
    case "$BAUD_TAG$AIPASS_VERSION" in
        *@*) fail "this is the unstamped source; download install.sh from a BAUD release" ;;
    esac

    parent="${1:-$HOME}"
    case "$parent" in
        /*) ;;
        *) parent="$(pwd -P)/$parent" ;;
    esac
    HOME_DIR="${parent%/}/AIPass"

    check_all
    print_table
    stop_on_uninstallable

    if [ -e "$HOME_DIR" ]; then
        say "$HOME_DIR already exists. This script never overwrites it, and aipass install"
        say "refuses an existing home. Nothing to install there; to refresh the phone face:"
        say "  aipass baud install --tag $BAUD_TAG"
        exit 0
    fi

    if ! has_tty; then
        say "No terminal to pause on. This script pauses once before it installs anything; run it"
        say "from a terminal, or download it and run: sh install.sh $parent"
        exit 2
    fi

    print_plan
    if ! read -r _ </dev/tty; then
        say "Nothing was changed."
        exit 0
    fi

    install_missing
    INSTALLED_CLI=""
    install_aipass_cli

    if [ ! -d "$parent" ]; then
        mkdir -p "$parent" || fail "could not create $parent; stopping here, and what was already installed stays"
    fi
    # Each ${AIPASS_SOURCE:+...} adds its own word only when set: a spaced path holds and SC2086 stays quiet.
    say "Running aipass install (this clones AIPass into $HOME_DIR${AIPASS_SOURCE:+ from $AIPASS_SOURCE})"
    if ! aipass install --non-interactive --no-chat --path "$HOME_DIR" --baud-tag "$BAUD_TAG" ${AIPASS_SOURCE:+--source} ${AIPASS_SOURCE:+"$AIPASS_SOURCE"}; then
        say ""
        say "aipass install stopped. Its own output above names the step."
        say "Already on disk:"
        [ -n "$INSTALLED_CLI" ] && say "  the aipass CLI ($AIPASS_VERSION)"
        [ -e "$HOME_DIR" ] && say "  $HOME_DIR (partial)"
        print_undo
        exit 1
    fi

    if [ -n "$TAILSCALE_NOT_UP" ]; then
        say ""
        say "Tailscale is not connected here, so the face listens on this machine only. Your"
        say "phone needs Tailscale on both sides: install it here if it is missing, run"
        say "'sudo tailscale up', then follow $GUIDE_URL"
    fi
    say ""
    # aipass install exits 0 even when its phone face step fails, so ask the disk:
    # the face's marker is written last and swapped in whole (aipass baud unpack).
    if [ -f "$HOME/.aipass/baud/phone/.baud-phone.json" ]; then
        say "BAUD $BAUD_TAG is installed in $HOME_DIR."
    else
        say "AIPass is installed in $HOME_DIR; the BAUD phone face is not (see above)."
        say "  Retry: aipass baud install --tag $BAUD_TAG"
    fi
    say "Phone guide: $GUIDE_URL"
    if [ -n "$CLAUDE_SIGNIN_SKIPPED" ]; then
        say "Claude Code is not signed in: run 'claude auth login' before running 'claude' in $HOME_DIR."
    fi
    say "If a new terminal cannot find aipass or claude, add \$HOME/.local/bin to your PATH."
    # One pointer, not the undo list: the full list scrolls the QR below off an 80x40 screen.
    say "To undo: $UNDO_URL (your home: $HOME_DIR)"

    # The code's five minutes start when it is made, so it waits for the phone.
    if tailscale_running; then
        # drone needs AIPASS_HOME, which setup.sh wrote to ~/.bashrc after this shell started.
        export AIPASS_HOME="$HOME_DIR"
        say ""
        say "Press Enter when your phone's camera is ready to scan (the code lasts five minutes)."
        if read -r _ </dev/tty; then
            # The last print is the whole pasteable fix: people read an install's end, not its middle.
            if ! drone @api host-api pair phone --scope operate; then
                say ""
                say "No QR. Paste these three lines into this terminal, then hold your phone up to the QR they print:"
                say "  export AIPASS_HOME=\"$HOME_DIR\""
                say "  drone @api host-api serve --detach"
                say "  drone @api host-api pair phone --scope operate"
                say "(If the second line refuses because the server is already running, that is fine: the third prints the QR.)"
            fi
        else
            say ""
            say "Skipped. To pair later, paste these three lines into a terminal, then hold your phone up to the QR they print:"
            say "  export AIPASS_HOME=\"$HOME_DIR\""
            say "  drone @api host-api serve --detach"
            say "  drone @api host-api pair phone --scope operate"
        fi
    fi
}

main "$@"
