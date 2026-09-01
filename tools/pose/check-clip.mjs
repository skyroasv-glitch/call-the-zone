/** Does any limb segment pass through the torso? Approximates the torso as a
 *  capsule from pelvis to the base of the neck and measures each bone against it. */
import * as THREE from "three";
import { rig } from "./solve-pose.mjs";
import { readPose, pelvisOf, emptyDirs } from "../../src/scene/poses.ts";
import { retargetDirs, anchorPelvis } from "../../src/scene/retarget.ts";

/*
 * Ribcage half-width, feet. Deliberately below the 0.69 ft shoulder span: the
 * chest is narrower than the shoulders, and a real front arm grazes it on the
 * way across. Arms landing just outside this are correct; ones well inside it
 * are the ones that render buried in the torso.
 */
const TORSO_R = 0.55;

function segDist(p0, p1, q0, q1) {
  const u = p1.clone().sub(p0), v = q1.clone().sub(q0), w = p0.clone().sub(q0);
  const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w), e = v.dot(w);
  const D = a * c - b * b;
  let sc, tc;
  if (D < 1e-8) { sc = 0; tc = b > c ? d / b : e / c; }
  else { sc = (b * e - c * d) / D; tc = (a * e - b * d) / D; }
  sc = Math.min(Math.max(sc, 0), 1); tc = Math.min(Math.max(tc, 0), 1);
  return p0.clone().addScaledVector(u, sc).distanceTo(q0.clone().addScaledVector(v, tc));
}

const name = process.argv[2] ?? "batterStance";
const { by, holder } = rig();
retargetDirs(by, readPose(name, false, emptyDirs()));
holder.updateMatrixWorld(true);
anchorPelvis(holder, by, pelvisOf(name, false, new THREE.Vector3()));
holder.updateMatrixWorld(true);

const P = (n) => by[n].getWorldPosition(new THREE.Vector3());
const spine0 = P("pelvis"), spine1 = P("neck_01");

console.log(`== ${name} ==   torso axis ${spine0.toArray().map(n=>+n.toFixed(2))} -> ${spine1.toArray().map(n=>+n.toFixed(2))}`);
for (const [label, a, b] of [
  ["upperarm_l", "upperarm_l", "lowerarm_l"], ["forearm_l", "lowerarm_l", "hand_l"],
  ["upperarm_r", "upperarm_r", "lowerarm_r"], ["forearm_r", "lowerarm_r", "hand_r"],
]) {
  const d = segDist(P(a), P(b), spine0, spine1);
  const flag = d < TORSO_R ? `  <-- INSIDE TORSO (needs > ${TORSO_R})` : "";
  console.log(`  ${label.padEnd(11)} distance to torso axis ${d.toFixed(2)} ft${flag}`);
}
