import { describe, expect, it } from "vitest";

import { CONTENT_FILE, ICON_FILE, WORKER_FILE } from "./entries";
import manifest from "./manifest.json";

// Globbed, not read with node:fs: the app's tsconfig carries no node types.
const pages = import.meta.glob("./*.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const icons = Object.keys(import.meta.glob("../../public/*.png"));

const KNOWN_PERMISSIONS = ["sidePanel", "storage", "tabs", "activeTab"];

describe("manifest (MV3, offline)", () => {
  it("is MV3 with a module service worker the build emits", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(typeof manifest.background.service_worker).toBe("string");
    expect(manifest.background.service_worker).toBe(WORKER_FILE);
    expect(manifest.background.type).toBe("module");
  });

  it("injects only the content file the build emits, on http(s) pages", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].js).toEqual([CONTENT_FILE]);
    expect(manifest.content_scripts[0].matches).toEqual(["http://*/*", "https://*/*"]);
  });

  it("asks only known permissions, and the host origin only on request", () => {
    for (const p of manifest.permissions) expect(KNOWN_PERMISSIONS).toContain(p);
    expect("host_permissions" in manifest).toBe(false);
    expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*", "<all_urls>"]);
  });

  it("names pages and an icon that exist", () => {
    expect(pages[`./${manifest.side_panel.default_path}`]).toBeTypeOf("string");
    expect(pages[`./${manifest.options_page}`]).toBeTypeOf("string");
    expect(manifest.icons["128"]).toBe(ICON_FILE);
    expect(icons).toContain(`../../public/${ICON_FILE}`);
  });

  it("loads no remote code", () => {
    const text = JSON.stringify(manifest);
    expect("content_security_policy" in manifest).toBe(false);
    expect(text).not.toMatch(/https?:\/\/[^*]/);
    for (const page of [manifest.side_panel.default_path, manifest.options_page]) {
      expect(pages[`./${page}`]).not.toMatch(/src="https?:/);
    }
  });
});
