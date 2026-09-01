import { readFileSync } from "node:fs";
import * as THREE from "three";
globalThis.self = globalThis;
/*
 * Enough of a DOM for FBXLoader to run headless. Models that reference textures
 * send it down the ImageLoader path, which wants a real <img>; we only ever want
 * the geometry, so the stub just has to not throw.
 */
if (!globalThis.document) {
  const stubEl = () => ({
    style: {}, setAttribute() {}, getContext: () => null,
    addEventListener() {}, removeEventListener() {},
  });
  globalThis.document = { createElementNS: stubEl, createElement: stubEl };
}
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");

export function loadFbx(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new FBXLoader().parse(ab, "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const obj = loadFbx(process.argv[2]);
  const names = [];
  obj.traverse((o) => { if (o.isBone) names.push(o.name); });
  console.log("bones:", names.length);
  console.log(names.join(" "));
  for (const a of obj.animations) {
    console.log(`\nclip "${a.name}" dur ${a.duration.toFixed(3)}`);
    const kinds = {};
    for (const t of a.tracks) {
      const kind = t.name.split(".").pop();
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    console.log("  track kinds:", JSON.stringify(kinds));
    console.log("  sample track names:", a.tracks.slice(0, 4).map((t) => t.name).join(", "));
  }
}
