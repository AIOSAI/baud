import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { CONTENT_FILE, ICON_FILE, WORKER_FILE } from "./src/extension/entries.ts";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The manifest and its icon ride into the output as they are; `public/` is the phone's PWA folder, not ours. */
const shipManifest: Plugin = {
  name: "baud-extension-manifest",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync(at("./src/extension/manifest.json")) });
    this.emitFile({ type: "asset", fileName: ICON_FILE, source: readFileSync(at(`./public/${ICON_FILE}`)) });
  },
};

/** The extension: the phone's http transport alias, never Tauri. `--mode content` is the second pass, for the
    content script alone, because a content script cannot be an ES module. */
export default defineConfig(({ mode }) => ({
  plugins: mode === "content" ? [] : [react(), shipManifest],
  root: at("./src/extension"),
  publicDir: false,
  resolve: {
    alias: [{ find: /^\.\/transport$/, replacement: at("./src/host/transport.http.ts") }],
  },
  build: {
    target: "es2021",
    sourcemap: false,
    outDir: at("./dist-extension"),
    emptyOutDir: mode !== "content",
    ...(mode === "content"
      ? {
          lib: { entry: at("./src/extension/content.ts"), formats: ["iife" as const], name: "baudContent", fileName: () => CONTENT_FILE },
        }
      : {
          rollupOptions: {
            input: {
              sidepanel: at("./src/extension/sidepanel.html"),
              options: at("./src/extension/options.html"),
              background: at("./src/extension/background.ts"),
            },
            output: {
              entryFileNames: (chunk: { name: string }) => (chunk.name === "background" ? WORKER_FILE : "assets/[name]-[hash].js"),
            },
          },
        }),
  },
}));
