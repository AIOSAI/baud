import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pinned and strict so tauri.conf.json's devUrl can never point at the wrong process.
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
