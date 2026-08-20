import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * WHICH TREE THIS BUNDLE WAS BUILT FROM, stamped into the bundle itself
 * (FPLAN-0446's deploy-record rider, @devpulse's ruling in 4114c1d2).
 *
 * Rebuild-is-deploy has twice served a phone face that no commit can produce -
 * the host's own access log named two bundles git cannot build - and the check
 * this app runs after every deploy proves TREE MATCHES SERVE, never GIT
 * MATCHES SERVE. The ruling was to build the RECORD rather than a refusal,
 * because serving a dirty tree is exactly how Patrick verifies before he
 * commits and forbidding it would break the loop it protects.
 *
 * It earned itself within the day. Round 3 failed live and the first question
 * was "is he even on the new bundle" - answerable this morning from the host's
 * access log, and by tonight not answerable at all: that log lives in a tmux
 * pane, the host had restarted fourteen times, and every one of today's bundle
 * names had been churned out of the scrollback. A stamp inside the bundle is a
 * record that cannot be scrolled away, and it can be read with one `curl` by
 * anyone, without the operator's help.
 *
 * READ VERBS ONLY, and never fatal: a build outside a repository, or without
 * git on PATH, stamps "unknown" and carries on. A build stamp that can break a
 * build is worse than no build stamp.
 */
function treeStamp(): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    const head = git("rev-parse", "--short", "HEAD");
    // Every path git considers modified, staged or untracked. The COUNT is the
    // honest headline - "clean" versus "3 dirty" is the whole question a reader
    // of this string is asking.
    const dirty = git("status", "--porcelain").split("\n").filter(Boolean).length;
    return dirty === 0 ? `${head} clean` : `${head} +${dirty} dirty`;
  } catch {
    return "unknown";
  }
}

/**
 * The phone face's build (FPLAN-0413 phase 4).
 *
 * A separate config rather than a mode flag on the desktop one, because the two
 * builds differ in exactly one way that must never happen by accident: the
 * ALIAS below. `host/index.ts` imports `./transport`; here that resolves to
 * `transport.http.ts` instead of the tauri binding, and every component above
 * the seam is compiled unchanged.
 *
 * That alias is the entire phone port. If it ever needs a second one, the seam
 * has sprung a leak and the leak is the bug - not the missing alias.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // A literal, so it survives minification as a findable string: `curl` the
    // served bundle, grep for it, and the answer needs nobody's phone.
    __BAUD_TREE__: JSON.stringify(`baud-tree ${treeStamp()}`),
  },
  resolve: {
    alias: [
      {
        find: /^\.\/transport$/,
        replacement: fileURLToPath(new URL("./src/host/transport.http.ts", import.meta.url)),
      },
    ],
  },
  server: {
    port: 1421, // never 1420 - the desktop's dev server owns that, strictly
    strictPort: true,
    proxy: {
      // The interim build loop: same-origin to the browser, so no CORS is
      // needed from @api while phase 5 is still a conversation.
      "/v1": {
        target: process.env.BAUD_API ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2021",
    sourcemap: false,
    outDir: "dist-phone",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./phone.html", import.meta.url)),
    },
  },
});
