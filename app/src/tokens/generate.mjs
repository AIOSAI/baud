/** tokens.json -> tokens.generated.css. Dependency-free and deterministic, so CI can prove the committed CSS matches. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

const lines = [
  "/* GENERATED from tokens.json by generate.mjs - DO NOT EDIT.",
  "   Change a value in tokens.json and run `npm run tokens`. */",
  ":root {",
];

for (const group of source.groups) {
  lines.push(`  /* ${group.name} */`);
  for (const [name, value] of Object.entries(group.tokens)) {
    lines.push(`  --baud-${name}: ${value};`);
  }
  lines.push("");
}

for (const [property, value] of Object.entries(source.root_properties)) {
  lines.push(`  ${property}: ${value};`);
}

lines.push("}", "");

writeFileSync(join(here, "tokens.generated.css"), lines.join("\n"), "utf8");
process.stdout.write("tokens.generated.css written\n");
