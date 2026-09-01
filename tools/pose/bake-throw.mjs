/**
 * Bakes a throwing clip into per-frame bone DIRECTIONS.
 *
 * The clip's skeleton has nothing in common with the mannequin we render — it
 * uses different bone names, a different bind pose and different proportions.
 * But the retargeter transfers poses by direction, so directions are all we
 * need: sample them once here and the same runtime path that drives the
 * procedural poses can play a real motion-captured throw.
 *
 *   node tools/pose/bake-throw.mjs <clip.fbx> [out.json]
 */
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { loadFbx } from "../fbxinfo.mjs";

const SRC = process.argv[2];
const OUT = process.argv[3];
const FPS = 60;

const root = loadFbx(SRC);
const clip = root.animations[0];

const bones = {};
root.traverse((o) => { if (o.isBone) bones[o.name] = o; });

const mixer = new THREE.AnimationMixer(root);
const action = mixer.clipAction(clip);
action.play();

/*
 * The clip is authored Z-up, and its root track animates the very node the
 * loader uses to correct that — so the correction is overwritten the moment the
 * mixer runs. Convert explicitly instead: Z-up (x, y, z) -> Y-up (x, z, -y).
 */
const zUpToYUp = (v) => v.set(v.x, v.z, -v.y);
const P = (n) => zUpToYUp(bones[n].getWorldPosition(new THREE.Vector3()));
const dir = (a, b) => P(b).sub(P(a)).normalize();

// ---- sample once at t=0 to work out scale and facing ------------------------
mixer.setTime(0);
root.updateMatrixWorld(true);

const hips0 = P("B-hips"), head0 = P("B-head"), foot0 = P("B-footL");
const rawHeight = head0.y - Math.min(foot0.y, P("B-footR").y);
console.log("foot y", foot0.y.toFixed(3));
console.log("raw hips y", hips0.y.toFixed(3), " head y", head0.y.toFixed(3),
            " height(hips->head)", rawHeight.toFixed(3));

// Match the mannequin: hips ride 3.0 ft up, so scale the clip to suit.
const UNIT = 3.0 / hips0.y;
console.log("unit scale (clip -> feet)", UNIT.toFixed(3));

/*
 * Which way does he throw? Deriving facing from the shoulder line gets the sign
 * wrong as easily as right, so calibrate off the motion instead: find the frame
 * where the throwing hand is moving fastest, and yaw the clip so that velocity
 * points at the plate (+z). Self-correcting for any clip.
 */
function handAt(t) {
  mixer.setTime(t);
  root.updateMatrixWorld(true);
  return P("B-handR").multiplyScalar(UNIT);
}

const nSamples = Math.round(clip.duration * FPS);
let peak = 1, peakSpeed = -Infinity, peakVel = new THREE.Vector3();
let prev = handAt(0);
for (let i = 1; i <= nSamples; i++) {
  const t = (i / nSamples) * clip.duration;
  const cur = handAt(t);
  const vel = cur.clone().sub(prev);
  const horiz = Math.hypot(vel.x, vel.z);
  if (horiz > peakSpeed) { peakSpeed = horiz; peak = i; peakVel = vel.clone(); }
  prev = cur;
}
const yaw = Math.atan2(peakVel.x, peakVel.z);
const fix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
console.log(`peak hand speed at frame ${peak}/${nSamples},`,
            `velocity ${peakVel.toArray().map((v) => +v.toFixed(2))},`,
            `yaw correction ${(-yaw * 180 / Math.PI).toFixed(1)} deg`);

const R = (v) => v.applyQuaternion(fix);

/** conceptual name -> [head bone, tail bone] */
const CHAIN = {
  thigh_l: ["B-thighL", "B-shinL"], calf_l: ["B-shinL", "B-footL"], foot_l: ["B-footL", "B-toeL"],
  thigh_r: ["B-thighR", "B-shinR"], calf_r: ["B-shinR", "B-footR"], foot_r: ["B-footR", "B-toeR"],
  upperarm_l: ["B-upperArmL", "B-forearmL"], lowerarm_l: ["B-forearmL", "B-handL"],
  upperarm_r: ["B-upperArmR", "B-forearmR"], lowerarm_r: ["B-forearmR", "B-handR"],
};

const frames = [];
const n = Math.round(clip.duration * FPS);
for (let i = 0; i <= n; i++) {
  const t = (i / n) * clip.duration;
  mixer.setTime(t);
  root.updateMatrixWorld(true);

  const f = { t: +t.toFixed(3), dirs: {} };
  for (const [name, [a, b]] of Object.entries(CHAIN))
    f.dirs[name] = R(dir(a, b)).toArray().map((v) => +v.toFixed(3));

  f.up = R(dir("B-hips", "B-chest")).toArray().map((v) => +v.toFixed(3));
  f.neck = R(dir("B-chest", "B-head")).toArray().map((v) => +v.toFixed(3));
  f.hipLine = R(dir("B-thighL", "B-thighR")).toArray().map((v) => +v.toFixed(3));
  f.shoulderLine = R(dir("B-upperArmL", "B-upperArmR")).toArray().map((v) => +v.toFixed(3));
  // the head bone's own long axis, converted the same way
  f.headUp = R(zUpToYUp(new THREE.Vector3(0, 1, 0)
    .applyQuaternion(bones["B-head"].getWorldQuaternion(new THREE.Quaternion()))))
    .normalize().toArray().map((v) => +v.toFixed(3));

  const hips = R(P("B-hips")).multiplyScalar(UNIT);
  f.hips = hips.toArray().map((v) => +v.toFixed(3));
  const hand = R(P("B-handR")).multiplyScalar(UNIT);
  f.hand = hand.toArray().map((v) => +v.toFixed(3));
  frames.push(f);
}

/*
 * `peak` is the frame at the END of the fastest segment, by which point the arm
 * has already whipped through. The ball leaves at the start of that segment,
 * with the arm extended and high — which is also where the hand height lines up
 * with the release height the trajectory maths assumes.
 */
const best = Math.max(0, peak - 1);
const release = frames[best];
console.log(`\nrelease frame ${best}/${n} at t=${release.t.toFixed(3)}s`,
            ` hand ${JSON.stringify(release.hand)}`);
console.log("hand path (t, x, y, z):");
for (let i = Math.max(0, best - 4); i <= Math.min(frames.length - 1, best + 3); i++)
  console.log(`  ${frames[i].t.toFixed(3)}  ${JSON.stringify(frames[i].hand)}${i === best ? "   <- release" : ""}`);

if (OUT) {
  const out = {
    source: SRC.split("/").pop(),
    fps: FPS,
    duration: +clip.duration.toFixed(3),
    releaseIndex: best,
    releaseTime: release.t,
    releaseHand: release.hand,
    frames,
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`\nwrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB, ${frames.length} frames)`);
}
