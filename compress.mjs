// compress.mjs — build-time re-encoder for entry.png.
//
// The gate is 1024x1024 and at most 1,048,576 bytes. Chrome's screenshot encoder
// leaves a lot on the table, so this rewrites the PNG with no dependencies:
//
//   1. lossless pass  — unfilter, re-filter each scanline with the cheapest of the
//                       five PNG filters, deflate at level 9;
//   2. depth pass     — if the lossless result is still above the target, round the
//                       colour channels to 7 (then 6) bits before deflating. On a
//                       gradient-heavy poster that is visually inert at 7 bits and
//                       keeps every edge, while cutting the entropy of the smooth
//                       bands that dominate the file.
//
// Never resizes, never resamples, never drops a row: the 1024x1024 frame and the
// middle-band detail survive either pass. Refuses to write a file over the cap.
//
// Usage: node compress.mjs [file] [--target-kb=900]

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAP = 1_048_576;
const moduleDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const targetKb = Number((args.find((a) => a.startsWith("--target-kb=")) ?? "").split("=")[1] ?? 900);
const target = targetKb * 1024;
const file = join(moduleDir, args.find((a) => !a.startsWith("--")) ?? "entry.png");

// ---- PNG chunk plumbing -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function readChunks(buf) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  const chunks = [];
  let pos = 8;
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    chunks.push({ type, data });
    pos += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 8 + data.length);
  return out;
}

function writePng(header, ancillary, idat) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...ancillary,
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- scanline filters -------------------------------------------------------

let BPP = 3; // set from IHDR below

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prev + x - bpp] : 0;
      let result;
      switch (filter) {
        case 0: result = value; break;
        case 1: result = value + left; break;
        case 2: result = value + up; break;
        case 3: result = value + ((left + up) >> 1); break;
        case 4: result = value + paeth(left, up, upLeft); break;
        default: throw new Error(`bad filter type ${filter} on row ${y}`);
      }
      out[row + x] = result & 0xff;
    }
    src += stride;
  }
  return out;
}

// Standard libpng heuristic: pick the filter whose residual has the smallest sum
// of absolute signed values. Costs one pass over the row per filter.
function filterRow(row, prev, stride, bpp, out, at) {
  const candidates = [];
  for (let type = 0; type <= 4; type++) {
    const line = Buffer.alloc(stride);
    let sum = 0;
    for (let x = 0; x < stride; x++) {
      const value = row[x];
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp] : 0;
      let residual;
      switch (type) {
        case 0: residual = value; break;
        case 1: residual = value - left; break;
        case 2: residual = value - up; break;
        case 3: residual = value - ((left + up) >> 1); break;
        case 4: residual = value - paeth(left, up, upLeft); break;
      }
      residual &= 0xff;
      line[x] = residual;
      sum += residual < 128 ? residual : 256 - residual;
    }
    candidates.push({ type, line, sum });
  }
  candidates.sort((a, b) => a.sum - b.sum);
  out[at] = candidates[0].type;
  candidates[0].line.copy(out, at + 1);
  return candidates[0].sum;
}

function filterAll(pixels, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    filterRow(row, prev, stride, bpp, out, y * (stride + 1));
  }
  return out;
}

// Round each channel to `bits` significant bits (7 bits = 128 levels per channel).
// Plain rounding, no dithering: dither noise would cost more bytes than it saves.
function quantize(pixels, bits) {
  if (bits >= 8) return pixels;
  const shift = 8 - bits;
  const half = 1 << (shift - 1);
  const out = Buffer.from(pixels);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.min(255, ((out[i] + half) >> shift) << shift);
  }
  return out;
}

// ---- main -------------------------------------------------------------------

const source = readFileSync(file);
const chunks = readChunks(source);
const ihdr = chunks.find((c) => c.type === "IHDR");
if (!ihdr) throw new Error("missing IHDR");

const width = ihdr.data.readUInt32BE(0);
const height = ihdr.data.readUInt32BE(4);
const bitDepth = ihdr.data[8];
const colorType = ihdr.data[9];
const interlace = ihdr.data[12];
if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
  throw new Error(`unsupported PNG: depth ${bitDepth} colourType ${colorType} interlace ${interlace}`);
}
if (width !== 1024 || height !== 1024) throw new Error(`unexpected frame ${width}x${height}`);
BPP = 3;

const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
const ancillary = chunks.filter((c) => c.type !== "IDAT" && c.type !== "IHDR" && c.type !== "IEND");
const pixels = unfilter(inflateSync(idat), width, height, BPP);

const attempts = [];
for (const bits of [8, 7, 6]) {
  const quantized = quantize(pixels, bits);
  const filtered = filterAll(quantized, width, height, BPP);
  const deflated = deflateSync(filtered, { level: 9, memLevel: 9, strategy: 0 });
  const png = writePng(ihdr.data, ancillary, deflated);
  attempts.push({ bits, bytes: png.length, png });
  console.log(`  bits=${bits}  ${png.length} B${png.length <= target ? "  <= target" : ""}`);
}

// Smallest bit depth that meets the target; else the smallest file under the cap.
const byQuality = attempts.filter((a) => a.bytes <= target);
const chosen = byQuality.length ? byQuality[0] : attempts.filter((a) => a.bytes <= CAP).pop();
if (!chosen) throw new Error(`cannot reach ${CAP} B; best ${attempts.at(-1).bytes} B`);

// Guard: every byte must stay inside the frame and under the cap.
const before = statSync(file).size;
writeFileSync(file, chosen.png);
const after = statSync(file).size;
if (after > CAP) throw new Error(`wrote ${after} B, over the ${CAP} B cap`);

// Report the pixel cost so the caller can see what the depth pass actually did.
const check = unfilter(inflateSync(Buffer.concat(readChunks(chosen.png).filter((c) => c.type === "IDAT").map((c) => c.data))), width, height, BPP);
let maxDelta = 0;
let sumDelta = 0;
for (let i = 0; i < pixels.length; i++) {
  const delta = Math.abs(pixels[i] - check[i]);
  if (delta > maxDelta) maxDelta = delta;
  sumDelta += delta;
}

console.log(`${file}: ${before} B -> ${after} B (${width}x${height}, ${chosen.bits}-bit channels)`);
console.log(`pixel delta vs source: max ${maxDelta}, mean ${(sumDelta / pixels.length).toFixed(3)}`);
