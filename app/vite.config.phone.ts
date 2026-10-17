import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The tree this bundle was built from, stamped inside it so `curl` can tell. Read-only git, never fatal: no git stamps "unknown". */
function treeStamp(): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    const head = git("rev-parse", "--short", "HEAD");
    const dirty = git("status", "--porcelain").split("\n").filter(Boolean).length;
    return dirty === 0 ? `${head} clean` : `${head} +${dirty} dirty`;
  } catch {
    return "unknown";
  }
}

/** The phone build: only the `./transport` alias differs; needing a second one means the seam leaked. */
export default defineConfig({
  plugins: [react()],
  define: {
    // A literal, so it survives minification as a greppable string in the served bundle.
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
