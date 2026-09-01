/** Works out the mannequin's palm axes and finger bend axis from the bind pose. */
import * as THREE from "three";
import { readGlb, buildSkeleton } from "./bind.mjs";

const { json } = readGlb("public/models/player.glb");
const { by } = buildSkeleton(json);
const P = (n) => by[n].getWorldPosition(new THREE.Vector3());
const arr = (v) => v.toArray().map((n) => +n.toFixed(3));

for (const s of ["l", "r"]) {
  const hand = by[`hand_${s}`];
  const fingerDir = P(`middle_03_${s}`).sub(P(`middle_01_${s}`)).normalize();
  const thumbDir = P(`thumb_03_${s}`).sub(P(`thumb_01_${s}`)).normalize();
  const spread = P(`index_01_${s}`).sub(P(`pinky_01_${s}`)).normalize();
  const palm = new THREE.Vector3().crossVectors(fingerDir, spread).normalize();

  // express in the hand bone's own frame
  const q = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
  const local = (v) => v.clone().applyQuaternion(q);

  console.log(`hand_${s}`);
  console.log("  finger dir world", arr(fingerDir), " local", arr(local(fingerDir)));
  console.log("  thumb  dir world", arr(thumbDir), " local", arr(local(thumbDir)));
  console.log("  palm normal world", arr(palm), " local", arr(local(palm)));

  // a finger curls by rotating its +y toward -palm; axis = y x (-palm)
  const fq = by[`middle_01_${s}`].getWorldQuaternion(new THREE.Quaternion()).invert();
  const axis = new THREE.Vector3().crossVectors(
    new THREE.Vector3(0, 1, 0),
    palm.clone().negate().applyQuaternion(fq).normalize(),
  ).normalize();
  console.log("  finger bend axis (bone local)", arr(axis));
}
