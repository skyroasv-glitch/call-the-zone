/**
 * Converts a single-mesh FBX prop to a small .glb, optionally baking in the
 * slice of a texture atlas that the prop actually uses.
 *
 * Source atlases are shared across every variant in a pack — 1024x1024 and
 * 2.18 MB for one bat. Rather than ship that, `--atlas` measures the prop's UV
 * bounds, crops the atlas to just that region, downscales, and rewrites the UVs
 * over the crop. Full detail where it matters, a fraction of the bytes.
 *
 *   node tools/fbx-to-glb.mjs in.fbx out.glb [--scale 0.0328]
 *          [--atlas texture.png] [--tex-height 512]
 */
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as THREE from "three";
import { loadFbx } from "./fbxinfo.mjs";

const [, , inPath, outPath] = process.argv;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
/** FBX props are authored in centimetres; the game works in feet. */
const SCALE = arg("scale", 1 / 30.48);
const strArg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const ATLAS = strArg("atlas");
const TEX_H = arg("tex-height", 512);

const root = loadFbx(inPath);
root.updateMatrixWorld(true);

const geos = [];
root.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry.clone();
  g.applyMatrix4(o.matrixWorld);
  geos.push(g);
});
if (geos.length !== 1) throw new Error(`expected one mesh, found ${geos.length}`);
const geo = geos[0].toNonIndexed ? geos[0] : geos[0];

// Stand it on its own origin: centred across, knob at y = 0, running up +y.
geo.computeBoundingBox();
const b = geo.boundingBox;
const mid = b.getCenter(new THREE.Vector3());
geo.translate(-mid.x, -b.min.y, -mid.z);
geo.scale(SCALE, SCALE, SCALE);
geo.computeVertexNormals();
geo.computeBoundingBox();
console.log("length", (geo.boundingBox.max.y).toFixed(3), "ft",
            " girth", (geo.boundingBox.max.x * 2).toFixed(3), "ft",
            " verts", geo.attributes.position.count);

// ---- write a minimal glb -----------------------------------------------------
const chunks = [];
const views = [];
let offset = 0;
const addView = (typed) => {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  while (offset % 4) { chunks.push(Buffer.alloc(1)); offset += 1; }
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
  chunks.push(buf); offset += buf.length;
  return views.length - 1;
};

/* ---- crop the atlas to the prop's own UVs, and rewrite them over the crop ---
 *
 * glTF puts UV (0,0) at the image's TOP-left; the FBX gives them OpenGL-style
 * from the bottom. The v flip happens here, once, rather than being left for
 * the renderer to guess at.
 */
let texture = null;
if (ATLAS) {
  const png = readFileSync(ATLAS);
  const W = png.readUInt32BE(16), H = png.readUInt32BE(20);
  const uvs = geo.attributes.uv.array;
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < uvs.length; i += 2) {
    u0 = Math.min(u0, uvs[i]); u1 = Math.max(u1, uvs[i]);
    v0 = Math.min(v0, uvs[i + 1]); v1 = Math.max(v1, uvs[i + 1]);
  }
  const x0 = Math.max(0, Math.floor(u0 * W));
  const y0 = Math.max(0, Math.floor((1 - v1) * H));
  const w = Math.min(W - x0, Math.ceil((u1 - u0) * W) + 1);
  const h = Math.min(H - y0, Math.ceil((v1 - v0) * H) + 1);
  console.log(`atlas ${W}x${H} -> crop ${w}x${h} at (${x0}, ${y0})`);

  const tmpCrop = `${outPath}.crop.png`, tmpJpg = `${outPath}.tex.jpg`;
  execFileSync("sips", ["-c", String(h), String(w), "--cropOffset", String(y0), String(x0),
    ATLAS, "--out", tmpCrop], { stdio: "ignore" });
  const outH = Math.min(TEX_H, h);
  const outW = Math.max(1, Math.round((w / h) * outH));
  execFileSync("sips", ["-z", String(outH), String(outW), tmpCrop,
    "-s", "format", "jpeg", "-s", "formatOptions", "88", "--out", tmpJpg], { stdio: "ignore" });
  texture = readFileSync(tmpJpg);
  unlinkSync(tmpCrop); unlinkSync(tmpJpg);
  console.log(`texture ${outW}x${outH} jpeg, ${(texture.length / 1024).toFixed(1)} KB`);

  for (let i = 0; i < uvs.length; i += 2) {
    uvs[i] = (uvs[i] * W - x0) / w;
    uvs[i + 1] = ((1 - uvs[i + 1]) * H - y0) / h;
  }
  geo.attributes.uv.needsUpdate = true;
}

const pos = geo.attributes.position.array;
const nor = geo.attributes.normal.array;
const uv = geo.attributes.uv?.array;

const accessors = [];
const addAccessor = (typed, type, comps) => {
  const view = addView(typed);
  const count = typed.length / comps;
  const min = Array(comps).fill(Infinity), max = Array(comps).fill(-Infinity);
  for (let i = 0; i < typed.length; i++) {
    const c = i % comps;
    if (typed[i] < min[c]) min[c] = typed[i];
    if (typed[i] > max[c]) max[c] = typed[i];
  }
  accessors.push({ bufferView: view, componentType: 5126, count, type, min, max });
  return accessors.length - 1;
};

const attributes = {
  POSITION: addAccessor(pos, "VEC3", 3),
  NORMAL: addAccessor(nor, "VEC3", 3),
};
if (uv) attributes.TEXCOORD_0 = addAccessor(uv, "VEC2", 2);

let imageView = null;
if (texture) imageView = addView(new Uint8Array(texture));

const bin = Buffer.concat(chunks);
const json = {
  asset: { version: "2.0", generator: "tools/fbx-to-glb.mjs" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "prop" }],
  meshes: [{ primitives: [{ attributes, material: 0 }] }],
  materials: [{
    name: "Wood",
    pbrMetallicRoughness: {
      ...(texture
        ? { baseColorTexture: { index: 0 } }
        : { baseColorFactor: [0.42, 0.26, 0.13, 1] }),
      metallicFactor: 0, roughnessFactor: 0.72,
    },
  }],
  ...(texture ? {
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: imageView, mimeType: "image/jpeg" }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  } : {}),
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: bin.length }],
};

const pad = (buf, fill) => {
  const rem = buf.length % 4;
  return rem ? Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]) : buf;
};
const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
const binChunk = pad(bin, 0);
const header = Buffer.alloc(12);
header.write("glTF", 0, "utf8");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHdr = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0); h.write(type, 4, "utf8");
  return h;
};
writeFileSync(outPath, Buffer.concat([
  header, chunkHdr(jsonChunk.length, "JSON"), jsonChunk, chunkHdr(binChunk.length, "BIN\0"), binChunk,
]));
console.log(`wrote ${outPath} (${(Buffer.concat([header, jsonChunk, binChunk]).length / 1024).toFixed(1)} KB)`);
