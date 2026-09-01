/**
 * Measures where the bat actually lies relative to both hands.
 *
 * The bat is not posed — it rides one hand bone and is aimed down `batAim`,
 * so whether the OTHER hand is on it is never stated anywhere: it is an
 * emergent result of the grip offset, the drop, and the two wrists' own
 * orientations. That makes it invisible in joint coordinates, the same way a
 * forearm buried in the ribcage is (see check-clip.mjs) — every angle reads
 * fine and only the render shows the hand holding air.
 *
 * This replays the shipping pose through the shipping reader, reconstructs the
 * bat line exactly as BatGrip does, and reports the perpendicular distance from
 * each hand to that line.
 *
 *   node tools/pose/check-grip.mjs                          # batterStance
 *   node tools/pose/check-grip.mjs batterLoad
 *   node tools/pose/check-grip.mjs batterStance 0.11 -0.22  # try other numbers
 *
 * The two trailing numbers are FIST_SHIFT and BAT_DROP from
 * src/scene/Players.tsx; pass them to sweep values before editing the app.
 */
import * as THREE from "three";
import { rig } from "./solve-pose.mjs";
import { readPose, pelvisOf, batAimOf, palmOf, emptyDirs } from "../../src/scene/poses.ts";
import { retargetDirs, anchorPelvis } from "../../src/scene/retarget.ts";

const name = process.argv[2] ?? "batterStance";
/** Mirrors src/scene/Players.tsx. Passed in so values can be tried without editing the app. */
const SHIFT = Number(process.argv[3] ?? 0.11);
const DROP = Number(process.argv[4] ?? -0.22);
/** How far past the wrist a closed fist's centre sits — only used for reporting. */
const FIST = 0.12;
/** Mirrors batterGrip() in Players.tsx — the twist is half of what is measured here. */
const palmDir = palmOf(name, false, new THREE.Vector3());
const HANDS = { gripL: 1.05, gripR: 1.05, palmL: palmDir, palmR: palmDir };
/** A 33-inch bat, knob at the model origin, barrel up +y. */
const BAT_LEN = 33 / 12;

const { by, holder } = rig();
const dirs = readPose(name, false, emptyDirs());
retargetDirs(by, dirs, HANDS);
holder.updateMatrixWorld(true);
anchorPelvis(holder, by, pelvisOf(name, false, new THREE.Vector3()));
holder.updateMatrixWorld(true);

const aim = batAimOf(name, false, new THREE.Vector3());

/** Where a hand's fist sits: along the bone's own +y from the wrist. */
function palm(bone) {
  const p = bone.getWorldPosition(new THREE.Vector3());
  const q = bone.getWorldQuaternion(new THREE.Quaternion());
  return p.add(new THREE.Vector3(0, FIST, 0).applyQuaternion(q));
}

const wristTop = by.hand_r.getWorldPosition(new THREE.Vector3());
const wristBot = by.hand_l.getWorldPosition(new THREE.Vector3());
const palmTop = palm(by.hand_r);
const palmBot = palm(by.hand_l);

/** Each hand's own +y — the axis a fist offset travels along. */
function axis(bone) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
}
const axTop = axis(by.hand_r), axBot = axis(by.hand_l);

// The bat line, exactly as BatGrip builds it: the wrist midpoint, shifted into
// the fists along the two hands' averaged axis with the barrel component
// removed, then slid by DROP so the knob clears the bottom hand.
const shiftDir = axTop.clone().add(axBot);
shiftDir.addScaledVector(aim, -shiftDir.dot(aim)).normalize();
const origin = wristTop.clone().add(wristBot).multiplyScalar(0.5).addScaledVector(shiftDir, SHIFT);
const knob = origin.clone().addScaledVector(aim, DROP);
const tip = knob.clone().addScaledVector(aim, BAT_LEN);

/** Perpendicular distance from a point to the bat line, and how far along it sits. */
function against(point) {
  const d = point.clone().sub(knob);
  const along = d.dot(aim);
  const off = d.clone().addScaledVector(aim, -along).length();
  return { along, off };
}

const v = (p) => `[${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}]`;
const inches = (ft) => `${(ft * 12).toFixed(2)} in`;

console.log(`== ${name} — fist shift ${SHIFT}, drop ${DROP} ==`);
console.log(`  bat aim      ${v(aim)}`);
console.log(`  knob         ${v(knob)}`);
console.log(`  barrel tip   ${v(tip)}`);
console.log("");
for (const [label, wrist, p] of [
  ["top (hand_r)", wristTop, palmTop],
  ["bottom (hand_l)", wristBot, palmBot],
]) {
  const w = against(wrist), g = against(p);
  console.log(`  ${label}`);
  console.log(`     wrist ${v(wrist)}  off-axis ${inches(w.off).padStart(9)}  ${inches(w.along)} up the bat`);
  console.log(`     fist  ${v(p)}  off-axis ${inches(g.off).padStart(9)}  ${inches(g.along)} up the bat`);
}

const wb = against(wristBot), wt = against(wristTop);
console.log("");
console.log(`  top hand axis     ${v(axTop)}`);
console.log(`  bottom hand axis  ${v(axBot)}`);
console.log(`  angle between     ${(Math.acos(Math.min(1, axTop.dot(axBot))) * 180 / Math.PI).toFixed(1)} deg`);
console.log("");
console.log(`  handle below the bottom wrist: ${inches(wb.along)}`);
console.log(`  wrist off-axis  top ${inches(wt.off)}   bottom ${inches(wb.off)}`);
console.log(`  asymmetry between hands:       ${inches(Math.abs(wt.off - wb.off))}`);
console.log("");
console.log("  Both wrists should sit the SAME distance off the barrel (~1-1.5 in,");
console.log("  a fist's worth), with 1-3 in of handle showing below the bottom hand.");
