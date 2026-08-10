# BAUD

BAUD is the AIPass desktop. AIPass agents — *citizens* — live in branch directories under
`<AIPASS_ROOT>/src/aipass/`, and each one leaves traces of itself on disk: a passport that
makes it a citizen, a dashboard file describing its mail and plans, and a dispatch lock that
appears exactly while it is awake and working. BAUD watches those traces and renders the
fleet as one screen, so you can see at a glance who is running, who has unread mail, and who
has gone quiet. **Milestone 1 is read-only by design** — it watches, it steers nothing. There
is no terminal, no write action, and no shell access anywhere in this build.

## Layout

```
app/
├── index.html                     Vite entry document
├── package.json                   dev / build / preview / tauri scripts
├── vite.config.ts                 dev server pinned to port 1420 (strict)
├── tsconfig.json                  app TS config
├── tsconfig.node.json             TS config for vite.config.ts
├── src/                           React 19 frontend
│   ├── main.tsx                   React root
│   ├── App.tsx                    polling loop, header, totals, failure banner
│   ├── types.ts                   TS mirrors of the Rust payload structs
│   ├── theme.css                  the whole stylesheet (--baud-* tokens)
│   └── components/
│       ├── FleetGrid.tsx          responsive grid, working-first sort
│       └── BranchCard.tsx         one branch + the relative-age helper
└── src-tauri/                     Rust backend
    ├── Cargo.toml                 lib `baud_lib` (staticlib/cdylib/rlib)
    ├── build.rs                   tauri_build::build()
    ├── tauri.conf.json            window, CSP, bundle config
    ├── capabilities/default.json  core defaults only
    └── src/
        ├── main.rs                thin wrapper → baud_lib::run()
        └── lib.rs                 root resolution, fleet scan, fleet_snapshot
```

## Running

```bash
npm install
npm run tauri dev
```

Linux system dependencies (WebKitGTK, GTK, and the SVG loader) must be present first:

```bash
sudo apt install pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
```

`npm run build` alone type-checks and produces `dist/` without touching the Rust toolchain,
which is useful for frontend-only work.

## Finding the AIPass root

No path is ever hardcoded. At runtime the Rust side resolves the root by:

1. `AIPASS_ROOT`, when set and containing a `src/aipass` directory; otherwise
2. walking up from the current working directory to the first ancestor containing `src/aipass`.

If neither works, `fleet_snapshot` returns a snapshot whose `error` field explains why, and the
UI prints it in a FAULT banner. Failure is reported, never swallowed into an empty grid.

## Security posture

This app is deliberately locked down — the opposite of a permissive desktop shell.

- **Strict CSP.** `default-src 'self'`. No remote origins, no CDNs, no inline scripts. The UI
  uses zero inline `style` attributes so that the policy needs no `unsafe-inline` escape hatch.
- **No shell plugin.** BAUD cannot execute a command, spawn a process, or open a terminal.
- **No filesystem plugin.** The frontend has no generalized file access of any kind.
- **No asset protocol.** Explicitly disabled; nothing on disk is addressable from the webview.
- **One command, read-only.** The entire Rust surface exposed to the frontend is
  `fleet_snapshot()`, which reads `DASHBOARD.local.json`, `.trinity/passport.json`, and
  `.ai_mail.local/.dispatch.lock` under the resolved root, and returns a struct. It takes no
  arguments, so the frontend cannot even steer *where* it reads.
- **Core capabilities only.** `capabilities/default.json` grants the main window `core:default`
  and nothing else.

The reasoning: BAUD renders the state of a fleet of autonomous agents, and a monitor that can
also act is a monitor you have to trust twice. Milestone 1 earns trust the cheap way — by
being structurally incapable of doing damage. Write actions, when they come, will arrive as
named commands with their own explicit capability grants, not by loosening this baseline.

## Failure tolerance

Every per-branch read degrades independently. A missing dashboard, malformed JSON, an
unreadable directory entry, or a branch with no passport all fall back to defaults for that one
card. A single bad file can never break the snapshot.
