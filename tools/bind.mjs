import { readFileSync } from "node:fs";
import * as THREE from "three";

export function readGlb(path) {
  const buf = readFileSync(path);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.toString("utf8", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type.startsWith("JSON")) json = JSON.parse(body.toString("utf8"));
    else bin = body;
    off += 8 + len;
  }
  return { json, bin, buf };
}

/** Rebuild the glTF node tree as three Objects, honouring each node's TRS. */
export function buildSkeleton(json) {
  const objs = json.nodes.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name ?? "";
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    if (n.matrix) {
      const m = new THREE.Matrix4().fromArray(n.matrix);
      m.decompose(o.position, o.quaternion, o.scale);
    }
    return o;
  });
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
  const childOf = new Set();
  json.nodes.forEach((n) => (n.children ?? []).forEach((c) => childOf.add(c)));
  const roots = objs.filter((_, i) => !childOf.has(i));
  const scene = new THREE.Object3D();
  roots.forEach((r) => scene.add(r));
  scene.updateMatrixWorld(true);
  const by = {};
  objs.forEach((o) => { if (o.name) by[o.name] = o; });
  return { scene, by, objs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { json } = readGlb(process.argv[2]);
  const { by, scene } = buildSkeleton(json);
  const P = (n) => by[n].getWorldPosition(new THREE.Vector3());
  const show = (n) => `${n} ${P(n).toArray().map((v) => +v.toFixed(3)).join(",")}`;
  for (const n of ["pelvis", "spine_03", "Head", "upperarm_l", "lowerarm_l", "hand_l",
                   "thigh_l", "calf_l", "foot_l", "ball_l"]) console.log(" ", show(n));

  const box = new THREE.Box3();
  scene.traverse((o) => box.expandByPoint(o.getWorldPosition(new THREE.Vector3())));
  const size = box.getSize(new THREE.Vector3());
  console.log("\njoint bbox:", size.toArray().map((v) => +v.toFixed(3)),
              " min y", +box.min.y.toFixed(3));
  const dir = (a, b) => P(b).sub(P(a)).normalize().toArray().map((v) => +v.toFixed(2));
  console.log("\nbind directions (world):");
  console.log("  thigh_l->calf_l ", dir("thigh_l", "calf_l"));
  console.log("  calf_l->foot_l  ", dir("calf_l", "foot_l"));
  console.log("  foot_l->ball_l  ", dir("foot_l", "ball_l"));
  console.log("  upperarm_l->lowerarm_l", dir("upperarm_l", "lowerarm_l"));
  console.log("  lowerarm_l->hand_l    ", dir("lowerarm_l", "hand_l"));
  console.log("  pelvis->spine_03      ", dir("pelvis", "spine_03"));
  const legLen = P("thigh_l").distanceTo(P("calf_l")) + P("calf_l").distanceTo(P("foot_l"));
  console.log("\nleg length", +legLen.toFixed(3), " pelvis height", +P("pelvis").y.toFixed(3));
}
