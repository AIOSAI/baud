import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BAUD runs inside a Tauri window. The dev server port is pinned and strict so
// that tauri.conf.json's devUrl can never point at the wrong process.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    sourcemap: false,
  },
});
