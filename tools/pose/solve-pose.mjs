/**
 * Solves poses against the ACTUAL glTF skeleton instead of a stand-in rig.
 *
 * The old approach posed a procedural rig with invented bone lengths and
 * transferred the result. Directions transferred exactly, but every joint landed
 * a third of a foot out because the two skeletons aren't the same shape. Solving
 * on the real bones removes that whole class of error: what the solver measures
 * is what the game draws.
 *
 * Output is PoseDirs — the same per-frame directions the throw clip uses — so
 * every player goes down one runtime path.
 */
import * as THREE from "three";
import { readGlb, buildSkeleton } from "../bind.mjs";
import { retargetDirs, emptyDirs } from "../../src/scene/retarget.ts";
import { twoBone } from "./ik.mjs";

export const SCALE = 3.0 / 0.83;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function rig() {
  const { json } = readGlb("public/models/player.glb");
  const { scene, by } = buildSkeleton(json);
  const holder = new THREE.Object3D();
  holder.scale.setScalar(SCALE);
  holder.add(scene);
  const world = new THREE.Object3D();
  world.add(holder);
  world.updateMatrixWorld(true);
  return { by, holder, world };
}

const P = (o) => o.getWorldPosition(new THREE.Vector3());

/** Rigid bone lengths in world units, read off the posed skeleton. */
function boneLengths(by) {
  const len = (a, b) => P(by[a]).distanceTo(P(by[b]));
  return {
    upperarm_l: len("upperarm_l", "lowerarm_l"), lowerarm_l: len("lowerarm_l", "hand_l"),
    upperarm_r: len("upperarm_r", "lowerarm_r"), lowerarm_r: len("lowerarm_r", "hand_r"),
    thigh_l: len("thigh_l", "calf_l"), calf_l: len("calf_l", "foot_l"),
    thigh_r: len("thigh_r", "calf_r"), calf_r: len("calf_r", "foot_r"),
  };
}

/**
 * spec: {
 *   pelvis, up, neck, headUp, hipLine, shoulderLine,
 *   hands: { l: {target, pole}, r: {...} },
 *   feet:  { l: {target, pole, toe}, r: {...} },
 * }
 */
export function solvePose(spec) {
  const { by, holder } = rig();
  const dirs = emptyDirs();
  dirs.up.copy(spec.up).normalize();
  dirs.neck.copy(spec.neck).normalize();
  dirs.headUp.copy(spec.headUp).normalize();
  if (spec.headLook) dirs.headLook.copy(spec.headLook).normalize();
  dirs.hipLine.copy(spec.hipLine).normalize();
  dirs.shoulderLine.copy(spec.shoulderLine).normalize();

  // Pass 1: torso only. The limb roots move with it, so they have to settle
  // before there is anything to solve the limbs against.
  retargetDirs(by, dirs);
  holder.updateMatrixWorld(true);
  holder.position.add(spec.pelvis.clone().sub(P(by.pelvis)));
  holder.updateMatrixWorld(true);

  const resolve = (v) => (typeof v === "function" ? v(by, P) : v);

  /*
   * Clavicles first. Moving a shoulder changes where every arm target is
   * measured from, so they have to settle before the arms are solved.
   */
  if (spec.clavicles) {
    for (const side of ["l", "r"]) {
      const want = spec.clavicles[side];
      if (!want) continue;
      const root = by[`clavicle_${side}`].parent.localToWorld(
        by[`clavicle_${side}`].position.clone());
      dirs.limbs[`clavicle_${side}`]
        .copy(resolve(want)).sub(root).normalize();
    }
    retargetDirs(by, dirs);
    holder.updateMatrixWorld(true);
    holder.position.add(spec.pelvis.clone().sub(P(by.pelvis)));
    holder.updateMatrixWorld(true);
  }

  const L = boneLengths(by);

  for (const side of ["l", "r"]) {
    const arm = spec.hands[side];
    if (arm) {
      const S = P(by[`upperarm_${side}`]);
      const target = resolve(arm.target);
      const E = twoBone(S, target, L[`upperarm_${side}`], L[`lowerarm_${side}`],
        resolve(arm.pole).clone().normalize());
      dirs.limbs[`upperarm_${side}`].copy(E).sub(S).normalize();
      dirs.limbs[`lowerarm_${side}`].copy(target).sub(E).normalize();
      /*
       * Aim the hand too, the way a leg aims its foot from `toe`. Without this
       * the hand keeps whatever the forearm's twist left it with, and two hands
       * meant to be holding the SAME object end up pointing tens of degrees
       * apart — which is how the batter's hands came to sit 62 deg off each
       * other on one bat.
       */
      if (arm.knuckles) dirs.limbs[`hand_${side}`].copy(resolve(arm.knuckles)).normalize();
      arm.solved = { S: S.clone(), E: E.clone(), target: target.clone() };
    }
    const leg = spec.feet[side];
    if (leg) {
      const S = P(by[`thigh_${side}`]);
      const target = resolve(leg.target);
      const E = twoBone(S, target, L[`thigh_${side}`], L[`calf_${side}`],
        resolve(leg.pole).clone().normalize());
      dirs.limbs[`thigh_${side}`].copy(E).sub(S).normalize();
      dirs.limbs[`calf_${side}`].copy(target).sub(E).normalize();
      dirs.limbs[`foot_${side}`].copy(leg.toe).normalize();
    }
  }
  // Pass 2: with limbs solved, re-apply and re-anchor.
  retargetDirs(by, dirs, spec.grip);
  holder.updateMatrixWorld(true);
  holder.position.add(spec.pelvis.clone().sub(P(by.pelvis)));
  holder.updateMatrixWorld(true);

  return { dirs, by, holder, lengths: L };
}

export const arr = (v) => v.toArray().map((n) => +n.toFixed(3));

/** Interior angle at the joint, for checking a limb bends like a limb. */
export function interior(by, root, mid, tip) {
  const a = P(by[root]).sub(P(by[mid])).normalize();
  const b = P(by[tip]).sub(P(by[mid])).normalize();
  return +(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * 180 / Math.PI).toFixed(1);
}

/** An elbow belongs below the hand and below the shoulder, near the ribs. */
export function armCheck(by, side) {
  const sh = P(by[`upperarm_${side}`]), el = P(by[`lowerarm_${side}`]), hd = P(by[`hand_${side}`]);
  return {
    elbowBelowShoulder: +(sh.y - el.y).toFixed(2),
    elbowBelowHand: +(hd.y - el.y).toFixed(2),
    interior: interior(by, `upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`),
    elbow: arr(el),
  };
}

export function report(by, label, extra = []) {
  console.log(`\n== ${label} ==`);
  const rows = ["pelvis", "spine_03", "Head",
    "upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r",
    ...extra];
  for (const n of rows) if (by[n]) console.log(`  ${n.padEnd(11)} ${JSON.stringify(arr(P(by[n])))}`);
  console.log(`  elbow L ${interior(by, "upperarm_l", "lowerarm_l", "hand_l")} deg`,
              ` elbow R ${interior(by, "upperarm_r", "lowerarm_r", "hand_r")} deg`);
  console.log(`  knee  L ${interior(by, "thigh_l", "calf_l", "foot_l")} deg`,
              ` knee  R ${interior(by, "thigh_r", "calf_r", "foot_r")} deg`);
}

export function dirsToJson(dirs) {
  const out = {
    up: arr(dirs.up), neck: arr(dirs.neck), headUp: arr(dirs.headUp),
    ...(dirs.headLook.lengthSq() > 1e-8 ? { headLook: arr(dirs.headLook) } : {}),
    hipLine: arr(dirs.hipLine), shoulderLine: arr(dirs.shoulderLine), limbs: {},
  };
  for (const k of Object.keys(dirs.limbs)) {
    // skip unset bones (zero direction) so they stay at bind
    if (dirs.limbs[k].lengthSq() > 1e-8) out.limbs[k] = arr(dirs.limbs[k]);
  }
  return out;
}
