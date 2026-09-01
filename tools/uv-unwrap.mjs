/*
 * Gives the mannequin a real UV layout.
 *
 * The Quaternius mesh ships a TEXCOORD_0 channel where every vertex sits at
 * (0, 1) — the attribute exists, but it carries no layout, so any texture
 * samples a single texel and comes out flat. That is why the players are solid
 * colours. This rebuilds the channel as a per-limb cylindrical unwrap so a
 * uniform can actually be painted on: pinstripes, panels, a number on the back.
 *
 * Each vertex is assigned to a body region by its heaviest skin weight, then
 * projected around that region's own bone axis:
 *
 *     v = distance along the bone, remapped to the region's measured extent
 *     u = angle around the bone
 *
 * and the result is packed into its own rectangle of the atlas (ATLAS below).
 *
 * The seam — where the angle wraps — is deliberately put on the body's right
 * side, which is where a real jersey's side seam runs. Vertices are not split
 * there, so triangles crossing it stretch across the island; with vertical
 * pinstripes that reads as a seam rather than a smear, and the back number sits
 * a quarter turn away from it.
 *
 *   node tools/uv-unwrap.mjs            # report only
 *   node tools/uv-unwrap.mjs --write    # …and write the glb back
 *
 * Idempotent: UVs are recomputed from POSITION every run, never from the
 * existing channel, so running it twice is the same as running it once.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLB = path.join(HERE, "..", "public", "models", "player.glb");
const ATLAS_JSON = path.join(HERE, "..", "src", "scene", "uv-atlas.json");

/* ------------------------------- regions --------------------------------- */

/*
 * A region is one island in the atlas: the bones that feed it, the bone pair
 * whose vector defines its axis, and the rect it occupies.
 *
 * `rect` is [x, y, w, h] in UV space. The torso gets a full quarter of the
 * sheet because it carries everything anyone will actually look at — the
 * number, the chest mark, the placket.
 */
const REGIONS = {
  torso: { bones: ["spine_01", "spine_02", "spine_03", "neck_01", "clavicle_l", "clavicle_r"],
    axis: ["spine_01", "neck_01"], rect: [0.00, 0.50, 0.50, 0.50] },
  head: { bones: ["Head"], axis: ["neck_01", "Head"], rect: [0.50, 0.75, 0.25, 0.25] },
  pelvis: { bones: ["pelvis", "root"], axis: ["pelvis", "spine_01"], rect: [0.75, 0.75, 0.25, 0.25] },

  upperarm_l: { bones: ["upperarm_l"], axis: ["upperarm_l", "lowerarm_l"], rect: [0.50, 0.50, 0.125, 0.25] },
  upperarm_r: { bones: ["upperarm_r"], axis: ["upperarm_r", "lowerarm_r"], rect: [0.625, 0.50, 0.125, 0.25] },
  lowerarm_l: { bones: ["lowerarm_l"], axis: ["lowerarm_l", "hand_l"], rect: [0.75, 0.50, 0.125, 0.25] },
  lowerarm_r: { bones: ["lowerarm_r"], axis: ["lowerarm_r", "hand_r"], rect: [0.875, 0.50, 0.125, 0.25] },

  thigh_l: { bones: ["thigh_l"], axis: ["thigh_l", "calf_l"], rect: [0.00, 0.25, 0.125, 0.25] },
  thigh_r: { bones: ["thigh_r"], axis: ["thigh_r", "calf_r"], rect: [0.125, 0.25, 0.125, 0.25] },
  calf_l: { bones: ["calf_l"], axis: ["calf_l", "foot_l"], rect: [0.25, 0.25, 0.125, 0.25] },
  calf_r: { bones: ["calf_r"], axis: ["calf_r", "foot_r"], rect: [0.375, 0.25, 0.125, 0.25] },

  hand_l: { bones: ["hand_l"], axis: ["hand_l", "middle_01_l"], rect: [0.50, 0.25, 0.125, 0.25] },
  hand_r: { bones: ["hand_r"], axis: ["hand_r", "middle_01_r"], rect: [0.625, 0.25, 0.125, 0.25] },
  foot_l: { bones: ["foot_l"], axis: ["foot_l", "ball_l"], rect: [0.75, 0.25, 0.125, 0.25] },
  foot_r: { bones: ["foot_r"], axis: ["foot_r", "ball_r"], rect: [0.875, 0.25, 0.125, 0.25] },
};

/** Bones with no island of their own ride along with the nearest one. */
const ALIAS = [
  [/^(index|middle|pinky|ring|thumb)_.*_l$/, "hand_l"],
  [/^(index|middle|pinky|ring|thumb)_.*_r$/, "hand_r"],
  [/^ball(_leaf)?_l$/, "foot_l"],
  [/^ball(_leaf)?_r$/, "foot_r"],
];

/** Keeps islands from bleeding into each other when the texture is filtered. */
const PAD = 0.006;

function regionOf(bone) {
  for (const [name, r] of Object.entries(REGIONS)) if (r.bones.includes(bone)) return name;
  for (const [re, target] of ALIAS) if (re.test(bone)) return target;
  return "torso";
}

/* ------------------------------ glb plumbing ------------------------------ */

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  return { json, bin: buf.subarray(binStart, binStart + binLen), jsonLen, binLen };
}

function writeGlb(file, json, bin) {
  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4) jsonText += " ";
  const jsonBuf = Buffer.from(jsonText, "utf8");
  const padBin = (4 - (bin.length % 4)) % 4;
  const binBuf = padBin ? Buffer.concat([bin, Buffer.alloc(padBin)]) : bin;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);

  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(jsonBuf.length, 0);
  jsonHdr.writeUInt32LE(0x4e4f534a, 4);

  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(binBuf.length, 0);
  binHdr.writeUInt32LE(0x004e4942, 4);

  fs.writeFileSync(file, Buffer.concat([header, jsonHdr, jsonBuf, binHdr, binBuf]));
}

/** Tightly-packed accessor reader — every attribute in this file is untangled. */
function accessor(json, bin, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  if (!comps) throw new Error(`unhandled accessor type ${a.type}`);
  const reader = {
    5121: (o) => bin.readUInt8(o), 5123: (o) => bin.readUInt16LE(o), 5126: (o) => bin.readFloatLE(o),
  }[a.componentType];
  const size = { 5121: 1, 5123: 2, 5126: 4 }[a.componentType];
  if (!reader) throw new Error(`unhandled componentType ${a.componentType}`);
  if (bv.byteStride && bv.byteStride !== comps * size) throw new Error("interleaved data");

  const out = [];
  for (let i = 0; i < a.count; i++) {
    const row = [];
    for (let c = 0; c < comps; c++) row.push(reader(base + (i * comps + c) * size));
    out.push(row);
  }
  return { data: out, base, comps, count: a.count };
}

/* --------------------------------- math ---------------------------------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Invert an affine 4x4 (column-major, as glTF stores it) and return its translation. */
function inverseTranslation(m) {
  // The bind matrix maps mesh space -> bone space; its inverse puts the bone
  // back in mesh space, and we only need where that lands.
  const r = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
  const t = [m[12], m[13], m[14]];
  const det =
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  const inv = [
    [(r[1][1] * r[2][2] - r[1][2] * r[2][1]) / det, (r[0][2] * r[2][1] - r[0][1] * r[2][2]) / det, (r[0][1] * r[1][2] - r[0][2] * r[1][1]) / det],
    [(r[1][2] * r[2][0] - r[1][0] * r[2][2]) / det, (r[0][0] * r[2][2] - r[0][2] * r[2][0]) / det, (r[0][2] * r[1][0] - r[0][0] * r[1][2]) / det],
    [(r[1][0] * r[2][1] - r[1][1] * r[2][0]) / det, (r[0][1] * r[2][0] - r[0][0] * r[2][1]) / det, (r[0][0] * r[1][1] - r[0][1] * r[1][0]) / det],
  ];
  return [
    -(inv[0][0] * t[0] + inv[0][1] * t[1] + inv[0][2] * t[2]),
    -(inv[1][0] * t[0] + inv[1][1] * t[1] + inv[1][2] * t[2]),
    -(inv[2][0] * t[0] + inv[2][1] * t[1] + inv[2][2] * t[2]),
  ];
}

/* -------------------------------- unwrap ---------------------------------- */

function main() {
  const write = process.argv.includes("--write");
  const { json, bin } = readGlb(GLB);
  const out = Buffer.from(bin); // copy: UVs are rewritten in place

  // Bind-pose joint positions, in the same space as POSITION.
  const skin = json.skins[0];
  const ibm = accessor(json, bin, skin.inverseBindMatrices);
  const jointPos = {};
  skin.joints.forEach((nodeIndex, i) => {
    jointPos[json.nodes[nodeIndex].name] = inverseTranslation(ibm.data[i]);
  });

  // Per-region frame: origin, axis, and the two perpendiculars the angle is
  // measured in. `ref` decides where the seam falls — see the header.
  const frames = {};
  for (const [name, r] of Object.entries(REGIONS)) {
    const [from, to] = r.axis;
    const origin = jointPos[from];
    const axis = norm(sub(jointPos[to], origin));
    // +X is the body's side, so measuring the angle from there drops the seam
    // on the side seam instead of down the chest.
    const raw = Math.abs(dot(axis, [1, 0, 0])) > 0.9 ? [0, 0, 1] : [1, 0, 0];
    const n = norm(sub(raw, axis.map((v) => v * dot(raw, axis))));
    frames[name] = { origin, axis, n, b: cross(axis, n) };
  }

  const stats = {};
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const pos = accessor(json, bin, prim.attributes.POSITION);
      const joints = accessor(json, bin, prim.attributes.JOINTS_0);
      const weights = accessor(json, bin, prim.attributes.WEIGHTS_0);
      const uv = accessor(json, bin, prim.attributes.TEXCOORD_0);

      // Pass 1: region per vertex, plus each region's extent along its axis.
      const region = [], along = [], angle = [];
      for (let i = 0; i < pos.count; i++) {
        let best = 0, bestW = -1;
        for (let k = 0; k < 4; k++) {
          if (weights.data[i][k] > bestW) { bestW = weights.data[i][k]; best = joints.data[i][k]; }
        }
        const bone = json.nodes[skin.joints[best]].name;
        const name = regionOf(bone);
        const f = frames[name];
        const d = sub(pos.data[i], f.origin);
        region.push(name);
        along.push(dot(d, f.axis));
        angle.push(Math.atan2(dot(d, f.b), dot(d, f.n)));
        (stats[name] ??= { verts: 0 }).verts++;
      }

      // Each island is normalised to its own measured extent, so a short bone
      // like a foot fills its rect instead of hugging one edge.
      const span = {};
      for (let i = 0; i < pos.count; i++) {
        const s = (span[region[i]] ??= { min: Infinity, max: -Infinity });
        s.min = Math.min(s.min, along[i]);
        s.max = Math.max(s.max, along[i]);
      }

      // Pass 2: pack into the atlas.
      for (let i = 0; i < pos.count; i++) {
        const name = region[i];
        const [rx, ry, rw, rh] = REGIONS[name].rect;
        const s = span[name];
        const t = s.max > s.min ? (along[i] - s.min) / (s.max - s.min) : 0.5;
        const a = angle[i] / (2 * Math.PI) + 0.5; // 0..1 around the bone

        const u = rx + PAD + a * (rw - 2 * PAD);
        const v = ry + PAD + t * (rh - 2 * PAD);
        out.writeFloatLE(u, uv.base + i * 8);
        out.writeFloatLE(v, uv.base + i * 8 + 4);
      }
    }
  }

  const rows = Object.entries(stats).sort((a, b) => b[1].verts - a[1].verts);
  for (const [name, s] of rows) console.log(`  ${name.padEnd(12)} ${String(s.verts).padStart(5)} verts`);
  console.log(`${rows.length} islands, ${rows.reduce((n, r) => n + r[1].verts, 0)} vertices`);

  if (!write) { console.log("\n(dry run — pass --write to update the glb)"); return; }
  writeGlb(GLB, json, out);
  console.log(`\nwrote ${GLB}`);

  /*
   * The uniform painter has to draw into the same rectangles this unwrap packed
   * into, so the layout is emitted rather than copied. Hand-keeping a second
   * copy in the app would mean a silent mis-paint the first time a rect moved.
   */
  const atlas = Object.fromEntries(
    Object.entries(REGIONS).map(([name, r]) => [name, r.rect]),
  );
  /*
   * Which way round the torso island the player is facing. The toes give the
   * forward direction, so the chest and back fall out of the same frame the
   * unwrap used — the painter needs it to put the number on the back rather
   * than across the chest.
   */
  const toe = norm(sub(jointPos.ball_l, jointPos.foot_l));
  const f = frames.torso;
  const uOf = (d) => Math.atan2(dot(d, f.b), dot(d, f.n)) / (2 * Math.PI) + 0.5;
  atlas._torsoFacing = {
    chest: +uOf(toe).toFixed(4),
    back: +uOf(toe.map((v) => -v)).toFixed(4),
  };
  fs.writeFileSync(ATLAS_JSON, `${JSON.stringify(atlas, null, 2)}\n`);
  console.log(`wrote ${ATLAS_JSON}`);
}

main();
