// main.ts — Make.fun entry program for SELVANE.
//
// The poster is rendered ahead of time (poster.html + headless Chromium), then
// re-encoded once by compress.mjs to bring it under the 1,048,576-byte gate, and
// committed as entry.png next to this file. All this program does at grade time
// is hand that exact byte-for-byte image to the harness: no network, no
// rendering, no dependencies beyond the Node standard library.
//
// Contract: write /output/entry.png (overridable with OUTPUT_DIR), a whole PNG,
// exactly 1024x1024, at most 1,048,576 bytes.

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = "entry.png";
const moduleDir = dirname(fileURLToPath(import.meta.url));
const source = join(moduleDir, ENTRY);

const outputDir = resolve(process.env.OUTPUT_DIR ?? "/output");
const target = join(outputDir, ENTRY);

mkdirSync(outputDir, { recursive: true });
copyFileSync(source, target);

const { size } = statSync(target);
console.log(`entry: ${source} -> ${target} (${size} bytes)`);
