/**
 * Where does the mannequin's throwing hand sit, relative to its own root, at
 * the moment of release? The scene places the pitcher by that offset so the
 * ball leaves his hand exactly where trajectory() starts it — otherwise the
 * ball pops from hand to release point on the first frame of flight.
 *
 *   node tools/pose/throw-anchor.mjs
 */
import * as THREE from "three";
import { readGlb, buildSkeleton } from "../bind.mjs";
import { retargetDirs, emptyDirs } from "../../src/scene/retarget.ts";
import { sampleThrow, THROW } from "../../src/scene/throwClip.ts";

const SCALE = 3.0 / 0.83;

function handOffset(mirror) {
  const { json } = readGlb("public/models/player.glb");
  const { scene, by } = buildSkeleton(json);
  const holder = new THREE.Object3D();
  holder.scale.setScalar(SCALE);
  holder.add(scene);
  holder.updateMatrixWorld(true);

  const dirs = sampleThrow(THROW.releaseTime, mirror, emptyDirs());
  retargetDirs(by, dirs, mirror ? { gripL: 0.9, gripR: 0.6 } : { gripR: 0.9, gripL: 0.6 });
  holder.updateMatrixWorld(true);

  const bone = mirror ? "hand_l" : "hand_r";
  const hand = by[bone].getWorldPosition(new THREE.Vector3());
  const pelvis = by.pelvis.getWorldPosition(new THREE.Vector3());
  return { hand, pelvis };
}

for (const mirror of [false, true]) {
  const { hand, pelvis } = handOffset(mirror);
  const f = (v) => v.toArray().map((n) => +n.toFixed(3));
  console.log(`${mirror ? "LHP" : "RHP"}  hand offset ${JSON.stringify(f(hand))}`,
              ` pelvis ${JSON.stringify(f(pelvis))}`);
}
