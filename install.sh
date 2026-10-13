#!/bin/sh
# BAUD installer - your AI agents on your phone, served from your own machine.
#
#   curl -fsSL https://github.com/AIOSAI/baud/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- ~/Projects     (installs to ~/Projects/AIPass)
#
# What it does, in order, and nothing before you say yes:
#   1. Checks what this machine has and prints one table: ok / missing / too old.
#   2. Installs each missing requirement, one at a time, with your yes.
#   3. Installs the aipass CLI from PyPI, at the version this release was built with.
#   4. Runs `aipass install`, which clones AIPass into <parent>/AIPass (default
#      $HOME/AIPass) and lands this release's phone face and baud-cli.
#   5. Ends quietly: aipass prints how to get your token to the phone.
#   6. Prints how to undo it.
#
# The careful path - check the script before running it:
#   curl -fsSLO https://github.com/AIOSAI/baud/releases/latest/download/install.sh
#   curl -fsSLO https://github.com/AIOSAI/baud/releases/latest/download/SHA256SUMS.txt
#   sha256sum -c --ignore-missing SHA256SUMS.txt
#   sh install.sh [parent-directory]
#
# release.yml stamps these two lines at pack time. The source in the repo is
# unstamped and refuses to run: download the script from a release.
BAUD_TAG="@BAUD_TAG@"
AIPASS_VERSION="@AIPASS_VERSION@"

PYTHON_FLOOR_MAJOR=3
PYTHON_FLOOR_MINOR=10
CLAUDE_INSTALLER="https://claude.ai/install.sh"
TAILSCALE_INSTALLER="https://tailscale.com/install.sh"
UV_INSTALLER="https://astral.sh/uv/install.sh"
GUIDE_URL="https://github.com/AIOSAI/baud/blob/main/docs/phone-setup-android.md"

# Everything lives in functions and main runs on the last line, so a download
# cut off halfway runs nothing at all.

say() { printf '%s\n' "$*"; }
fail() {
    printf 'install.sh: %s\n' "$*" >&2
    exit 1
}

# Every question reads from the terminal, not stdin: stdin is this script when
# it is piped from curl.
has_tty() { (: </dev/tty) 2>/dev/null; }

ask() {
    printf '%s [y/N] ' "$1" >/dev/tty
    read -r answer </dev/tty || return 1
    case "$answer" in
        y | Y | yes | YES) return 0 ;;
        *) return 1 ;;
    esac
}

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

# The per-user installers (Claude Code, uv, pipx) land in ~/.local/bin, which a
# fresh shell may not have on PATH yet.
PATH="$HOME/.local/bin:$PATH"
export PATH

# --- phase 1: the preflight table ------------------------------------------

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

# --- phase 2: install what is missing, with a yes each ----------------------

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

# One apt row: its table state, then the package.
apt_row() {
    [ "$1" = missing ] || return 0
    ask "Install $2 with apt?" || fail "$2 is required; stopping here, and what was already installed stays"
    apt_install "$2"
}

# What no yes can fix stops before the first question.
stop_on_uninstallable() {
    if [ "$STATE_platform" != ok ]; then
        fail "BAUD runs on Linux x86_64 only for now; this machine is $(uname -s) $(uname -m)"
    fi
    if [ "$STATE_python" = "too old" ]; then
        fail "python3 is $(python3 -c 'import sys; print(sys.version.split()[0])'); AIPass needs $PYTHON_FLOOR_MAJOR.$PYTHON_FLOOR_MINOR or newer, and this script will not replace your system python"
    fi
}

install_missing() {
    apt_row "$STATE_git" git
    apt_row "$STATE_tmux" tmux
    apt_row "$STATE_curl" curl
    if [ "$STATE_sha256" = missing ]; then
        ask "Install coreutils (sha256sum) with apt?" || fail "sha256sum is required; stopping here, and what was already installed stays"
        apt_install coreutils
    fi
    if [ "$STATE_python" = missing ]; then
        ask "Install python3 with apt?" || fail "python3 is required; stopping here, and what was already installed stays"
        apt_install python3 python3-venv
        python_ok || fail "apt's python3 is older than $PYTHON_FLOOR_MAJOR.$PYTHON_FLOOR_MINOR; install a newer python3, then run this script again"
    fi
    if [ "$STATE_pyinstaller" = missing ]; then
        ask "Install uv (Astral's own installer, into ~/.local/bin, no sudo)?" || fail "pipx or uv is required to install the aipass CLI"
        curl -LsSf "$UV_INSTALLER" | sh
        have uv || fail "uv's installer finished but uv is not on PATH"
    fi
    if [ "$STATE_claude" = missing ]; then
        ask "Install Claude Code (Anthropic's own installer)?" || fail "Claude Code is required: the agents run in it"
        curl -fsSL "$CLAUDE_INSTALLER" | bash
        have claude || fail "Claude Code's installer finished but claude is not on PATH"
    fi
    CLAUDE_SIGNIN_SKIPPED=""
    if ! claude_signed_in; then
        say "Claude Code needs you signed in. Anthropic's own sign-in runs now;"
        say "this script never sees your credentials."
        if ask "Sign in to Claude Code now?"; then
            claude auth login </dev/tty >/dev/tty 2>&1 || fail "the Claude Code sign-in did not finish"
            claude_signed_in || fail "Claude Code still reports signed out"
        else
            CLAUDE_SIGNIN_SKIPPED=1
        fi
    fi
    TAILSCALE_DECLINED=""
    if [ "$STATE_tailscale" = missing ]; then
        if ask "Install Tailscale (its own installer, uses sudo)?"; then
            curl -fsSL "$TAILSCALE_INSTALLER" | sh
        else
            TAILSCALE_DECLINED=1
        fi
    fi
    if [ -z "$TAILSCALE_DECLINED" ] && ! tailscale_running; then
        say "Tailscale prints a sign-in link: open it, sign in, and come back."
        if ask "Connect this machine to your tailnet now (sudo tailscale up)?"; then
            if ! (as_root tailscale up </dev/tty >/dev/tty 2>&1); then
                say "tailscale up did not finish; to connect this machine later, run: sudo tailscale up"
                TAILSCALE_DECLINED=1
            fi
        else
            TAILSCALE_DECLINED=1
        fi
    fi
}

# --- phases 3 and 4: the aipass CLI, then aipass install --------------------

install_aipass_cli() {
    if have aipass; then
        say "aipass is already installed ($(aipass --version 2>/dev/null || say unknown version)); leaving it as it is."
        say "  this release was built with aipass $AIPASS_VERSION"
        return 0
    fi
    if have pipx; then
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
        say "No terminal to ask on. This script asks before it installs anything; run it"
        say "from a terminal, or download it and run: sh install.sh $parent"
        exit 2
    fi

    ask "Install BAUD $BAUD_TAG with AIPass into $HOME_DIR?" || {
        say "Nothing was changed."
        exit 0
    }

    install_missing
    INSTALLED_CLI=""
    install_aipass_cli

    if [ ! -d "$parent" ]; then
        mkdir -p "$parent" || fail "could not create $parent; stopping here, and what was already installed stays"
    fi
    say "Running aipass install (this clones AIPass into $HOME_DIR)"
    if ! aipass install --non-interactive --no-chat --path "$HOME_DIR" --baud-tag "$BAUD_TAG"; then
        say ""
        say "aipass install stopped. Its own output above names the step."
        say "Already on disk:"
        [ -n "$INSTALLED_CLI" ] && say "  the aipass CLI ($AIPASS_VERSION)"
        [ -e "$HOME_DIR" ] && say "  $HOME_DIR (partial)"
        print_undo
        exit 1
    fi

    if [ -n "$TAILSCALE_DECLINED" ]; then
        say ""
        say "Tailscale was skipped, so the face listens on this machine only. Your phone"
        say "needs Tailscale on both sides: install it here, run 'sudo tailscale up', then"
        say "follow $GUIDE_URL"
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
    print_undo
}

main "$@"
