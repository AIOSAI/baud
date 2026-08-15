import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
