/**
 * Drop animation clips from a .glb and repack the binary chunk with only the
 * accessors still referenced. We pose the skeleton ourselves, so the clips are
 * dead weight — and they are the bulk of the file.
 *
 *   node tools/strip-glb.mjs in.glb out.glb
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
const buf = readFileSync(inPath);
if (buf.toString("utf8", 0, 4) !== "glTF") throw new Error("not a glb");

let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.toString("utf8", off + 4, off + 8);
  const body = buf.subarray(off + 8, off + 8 + len);
  if (type.startsWith("JSON")) json = JSON.parse(body.toString("utf8"));
  else bin = Buffer.from(body);
  off += 8 + len;
}
const before = { anims: json.animations?.length ?? 0, bin: bin.length };

delete json.animations;

// -- collect accessors still referenced -------------------------------------
const keepAcc = new Set();
for (const m of json.meshes ?? [])
  for (const p of m.primitives ?? []) {
    Object.values(p.attributes ?? {}).forEach((a) => keepAcc.add(a));
    if (p.indices !== undefined) keepAcc.add(p.indices);
    for (const t of p.targets ?? []) Object.values(t).forEach((a) => keepAcc.add(a));
  }
for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) keepAcc.add(s.inverseBindMatrices);

// -- rebuild accessors / bufferViews over a fresh bin ------------------------
const accMap = new Map(), viewMap = new Map();
const newAccessors = [], newViews = [], chunks = [];
let cursor = 0;

const compTypeSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const numComps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

for (const [i, acc] of (json.accessors ?? []).entries()) {
  if (!keepAcc.has(i)) continue;
  const next = { ...acc };
  if (acc.bufferView !== undefined) {
    const bv = json.bufferViews[acc.bufferView];
    const stride = bv.byteStride ?? compTypeSize[acc.componentType] * numComps[acc.type];
    const byteLen = bv.byteLength;
    const src = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + byteLen);
    const key = `${acc.bufferView}`;
    let viewIdx = viewMap.get(key);
    if (viewIdx === undefined) {
      while (cursor % 4 !== 0) { chunks.push(Buffer.alloc(1)); cursor += 1; }
      const nv = { buffer: 0, byteOffset: cursor, byteLength: byteLen };
      if (bv.byteStride !== undefined) nv.byteStride = bv.byteStride;
      if (bv.target !== undefined) nv.target = bv.target;
      chunks.push(src); cursor += byteLen;
      viewIdx = newViews.push(nv) - 1;
      viewMap.set(key, viewIdx);
      void stride;
    }
    next.bufferView = viewIdx;
  }
  accMap.set(i, newAccessors.push(next) - 1);
}

// images live in bufferViews too — carry them across
for (const img of json.images ?? []) {
  if (img.bufferView === undefined) continue;
  const bv = json.bufferViews[img.bufferView];
  const src = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  while (cursor % 4 !== 0) { chunks.push(Buffer.alloc(1)); cursor += 1; }
  const nv = { buffer: 0, byteOffset: cursor, byteLength: bv.byteLength };
  chunks.push(src); cursor += bv.byteLength;
  img.bufferView = newViews.push(nv) - 1;
}

const remap = (i) => {
  const v = accMap.get(i);
  if (v === undefined) throw new Error(`accessor ${i} was dropped but is still referenced`);
  return v;
};
for (const m of json.meshes ?? [])
  for (const p of m.primitives ?? []) {
    for (const k of Object.keys(p.attributes ?? {})) p.attributes[k] = remap(p.attributes[k]);
    if (p.indices !== undefined) p.indices = remap(p.indices);
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = remap(t[k]);
  }
for (const s of json.skins ?? [])
  if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = remap(s.inverseBindMatrices);

json.accessors = newAccessors;
json.bufferViews = newViews;
const newBin = Buffer.concat(chunks);
json.buffers = [{ byteLength: newBin.length }];

// -- write ------------------------------------------------------------------
const pad = (b, to, fill) => {
  const rem = b.length % to;
  return rem === 0 ? b : Buffer.concat([b, Buffer.alloc(to - rem, fill)]);
};
const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 4, 0x20);
const binChunk = pad(newBin, 4, 0);
const header = Buffer.alloc(12);
header.write("glTF", 0, "utf8");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHdr = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.write(type, 4, "utf8");
  return b;
};
writeFileSync(outPath, Buffer.concat([
  header,
  chunkHdr(jsonChunk.length, "JSON"), jsonChunk,
  chunkHdr(binChunk.length, "BIN\0"), binChunk,
]));

console.log(`${inPath}\n  -> ${outPath}`);
console.log(`  animations ${before.anims} -> 0`);
console.log(`  bin ${(before.bin / 1e6).toFixed(2)}MB -> ${(newBin.length / 1e6).toFixed(2)}MB`);
console.log(`  file ${(buf.length / 1e6).toFixed(2)}MB -> ${(readFileSync(outPath).length / 1e6).toFixed(2)}MB`);
