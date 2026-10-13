# Undoing a BAUD install

Everything `install.sh` and `aipass install` put on the machine, and how to take it off. `<home>` is your AIPass folder, which the installer named in its last lines (default `~/AIPass`). If an install stops partway, the installer prints this same list with your own paths filled in.

1. Remove the aipass CLI: `pipx uninstall aipass`, or `uv tool uninstall aipass` if uv installed it.
2. Remove the AIPass home: `rm -rf <home>`.
3. Remove the phone face and baud-cli: `rm -rf ~/.aipass/baud`.
4. Remove the global command links: `sudo rm /usr/local/bin/aipass /usr/local/bin/drone`.
5. In `~/.bashrc` (and `~/.zshrc`, if you have one):
   - delete the `# AIPass — cross-project access` lines (`export AIPASS_HOME=...`);
   - delete the block from `# >>> AIPass boot shim >>>` to `# <<< AIPass boot shim <<<`.
6. In `~/.claude/settings.json`, remove what `setup.sh` added: the AIPass hooks, the `AIPASS_HOME` env entry, the permission rules and the `includeGitInstructions` value.
7. Remove the `/memo` command: `rm ~/.claude/commands/memo.md`.
8. Remove the API keys file: `rm -rf ~/.secrets/aipass`. That folder also holds the host API's files under `host_api/`: the token receipts and the pairing codes.
9. Remove the hook trust registry: `rm ~/.aipass/trusted_projects.json`.

Claude Code, Tailscale and the apt packages (git, tmux, curl, python3) stay. Remove them with their own tools if you want them gone.

On each phone, sign out (the gear, then **sign out**) so its browser forgets the token. Once the host API is gone, the token reaches nothing.
