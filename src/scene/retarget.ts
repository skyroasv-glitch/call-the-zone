import * as THREE from "three";

export type BoneMap = Record<string, THREE.Object3D>;

/**
 * Poses a glTF skeleton from world-space bone directions.
 *
 * Every pose in the game — the solved stances, the motion-captured throw — is
 * expressed the same way: which direction each bone points. Nothing carries a
 * skeleton's local rotations around, because local rotations only mean anything
 * relative to a bind pose, and the sources here don't share one.
 *
 * Aiming a bone leaves the twist about its own axis undefined. That is
 * invisible on a limb but very visible on a torso, so the pelvis and chest are
 * additionally rolled until their hip and shoulder lines match, and hands get
 * their palms rolled explicitly.
 */

const UP = new THREE.Vector3(0, 1, 0);
/** The mannequin's head looks along its own local +z (measured from the bind). */
const FORWARD = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();

function dirBetween(from: THREE.Object3D, to: THREE.Object3D, out: THREE.Vector3) {
  to.getWorldPosition(out);
  from.getWorldPosition(_b);
  return out.sub(_b).normalize();
}

/** Point `bone`'s local +y along `dir` (world space) with the least rotation. */
function aim(bone: THREE.Object3D, dir: THREE.Vector3) {
  if (!bone.parent || dir.lengthSq() < 1e-8) return;
  bone.getWorldQuaternion(_q);
  _c.copy(UP).applyQuaternion(_q).normalize();
  _qd.setFromUnitVectors(_c, dir);
  _q.premultiply(_qd);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q));
  bone.updateMatrixWorld(true);
}

/**
 * Spin `bone` about `axis` until the line between `refA` and `refB` lines up
 * with `target`. Used to give the torso a facing, which aiming can't supply.
 */
function roll(
  bone: THREE.Object3D, axis: THREE.Vector3,
  refA: THREE.Object3D, refB: THREE.Object3D, target: THREE.Vector3,
) {
  if (!bone.parent) return;
  dirBetween(refA, refB, _d);
  _d.addScaledVector(axis, -_d.dot(axis));
  _e.copy(target).addScaledVector(axis, -target.dot(axis));
  if (_d.lengthSq() < 1e-8 || _e.lengthSq() < 1e-8) return;
  _d.normalize(); _e.normalize();
  const angle = Math.atan2(_c.crossVectors(_d, _e).dot(axis), _d.dot(_e));
  _qd.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_q);
  _q.premultiply(_qd);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q));
  bone.updateMatrixWorld(true);
}

/**
 * Bones a pose can aim, parents before children — a clavicle has to be placed
 * before the arm hanging off it, or the arm is aimed from a stale shoulder.
 *
 * The clavicles matter more than they look. With the shoulders a fixed 1.4 ft
 * apart, two hands cannot meet on a bat handle without one arm locking straight;
 * a real shoulder girdle protracts to close the gap, and so does this one.
 */
const BONES = [
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
  "thigh_l", "calf_l", "foot_l",
  "thigh_r", "calf_r", "foot_r",
];

const SPINE = ["spine_01", "spine_02", "spine_03"];

const FINGERS = ["index", "middle", "ring", "pinky"];
/** Proximal / middle / distal share the curl unevenly, as a real hand does. */
const KNUCKLE_BIAS = [0.75, 1, 0.85];

/**
 * Curl the fingers. Measured from the bind pose: finger bones run along local
 * +y and curl about local x — negative on the left hand, positive on the right.
 * Left flat, the splayed default reads as jazz hands on anyone holding a bat.
 */
function grip(bones: BoneMap, side: "l" | "r", amount: number) {
  if (!amount) return;
  const sign = side === "l" ? -1 : 1;
  for (const f of FINGERS) {
    for (let k = 0; k < 3; k++) {
      const b = bones[`${f}_0${k + 1}_${side}`];
      if (b) b.rotation.x = sign * amount * KNUCKLE_BIAS[k];
    }
  }
  // the thumb opposes rather than curls, so it gets less and a slight splay
  for (let k = 0; k < 3; k++) {
    const b = bones[`thumb_0${k + 1}_${side}`];
    if (b) b.rotation.set(sign * amount * 0.45, 0, sign * amount * (k === 0 ? -0.5 : 0));
  }
}

/** Spin `bone` about `axis` so `current` swings onto `target`. */
function rollTo(
  bone: THREE.Object3D, axis: THREE.Vector3,
  current: THREE.Vector3, target: THREE.Vector3,
) {
  if (!bone.parent) return;
  _d.copy(current).addScaledVector(axis, -current.dot(axis));
  _e.copy(target).addScaledVector(axis, -target.dot(axis));
  if (_d.lengthSq() < 1e-8 || _e.lengthSq() < 1e-8) return;
  _d.normalize(); _e.normalize();
  const angle = Math.atan2(_f.crossVectors(_d, _e).dot(axis), _d.dot(_e));
  _qd.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_q);
  _q.premultiply(_qd);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q));
  bone.updateMatrixWorld(true);
}

/** The hand's palm normal is its local +x (measured from the bind pose). */
const PALM_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Roll the forearm so the palm faces `target`. Aiming a bone fixes its
 * direction but leaves the spin about that direction undefined — harmless on a
 * forearm, glaring on the flat, five-fingered thing attached to the end of it.
 */
function facePalm(
  bones: BoneMap, side: "l" | "r", target: THREE.Vector3, handAimed: boolean,
) {
  const fore = bones[`lowerarm_${side}`], hand = bones[`hand_${side}`];
  if (!fore || !hand) return;
  hand.getWorldQuaternion(_q);
  const palm = PALM_AXIS.clone().applyQuaternion(_q).normalize();

  if (handAimed) {
    /*
     * The pose aimed this hand, so the twist belongs to the hand and is taken
     * about the hand's own axis. Rolling the forearm here would carry the hand
     * round with it and undo that aim — which is exactly what kept the batter's
     * two hands pointing tens of degrees apart even after they were aimed.
     */
    const axis = _c.set(0, 1, 0).applyQuaternion(_q).normalize().clone();
    rollTo(hand, axis, palm, target);
    return;
  }

  // Otherwise the palm is turned the anatomical way, by pronating the forearm.
  hand.getWorldPosition(_a);
  fore.getWorldPosition(_b);
  const axis = _c.copy(_a).sub(_b).normalize().clone();
  rollTo(fore, axis, palm, target);
}

/**
 * Two-bone IK in world space: put `hand` on `target` by bending at the elbow,
 * with `pole` deciding which way the elbow points. Used at runtime so the
 * catcher's glove actually reaches for the pitch instead of the mitt sliding
 * off his wrist.
 */
export function reachArm(
  bones: BoneMap, side: "l" | "r", target: THREE.Vector3, pole: THREE.Vector3,
) {
  const upper = bones[`upperarm_${side}`];
  const fore = bones[`lowerarm_${side}`];
  const hand = bones[`hand_${side}`];
  if (!upper || !fore || !hand) return;

  upper.getWorldPosition(_a);
  fore.getWorldPosition(_b);
  hand.getWorldPosition(_c);
  const a = _a.distanceTo(_b), b = _b.distanceTo(_c);

  const reach = _d.copy(target).sub(_a);
  const d = Math.min(Math.max(reach.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
  const u = reach.normalize();
  const cosA = Math.min(Math.max((a * a + d * d - b * b) / (2 * a * d), -1), 1);
  const alpha = Math.acos(cosA);

  const w = _e.copy(pole).addScaledVector(u, -pole.dot(u));
  if (w.lengthSq() < 1e-8) return;
  w.normalize();

  // elbow position on the solution circle nearest the pole
  const elbow = _f.copy(u).multiplyScalar(a * Math.cos(alpha))
    .addScaledVector(w, a * Math.sin(alpha)).add(_a);

  aim(upper, _b.copy(elbow).sub(_a).normalize());
  fore.getWorldPosition(_a);
  aim(fore, _c.copy(target).sub(_a).normalize());
}

/**
 * Slide `model` until its pelvis sits on `target`, which is expressed in the
 * model group's parent space. Bone rotations never move the pelvis node, so
 * without this every pose would be drawn at the skeleton's bind height.
 */
export function anchorPelvis(
  model: THREE.Object3D, bones: BoneMap, target: THREE.Vector3,
) {
  const pelvis = bones.pelvis, parent = model.parent;
  if (!pelvis || !parent) return;
  parent.updateWorldMatrix(true, false);
  pelvis.getWorldPosition(_a);
  parent.worldToLocal(_a);
  model.position.add(_b.copy(target).sub(_a));
  model.updateMatrixWorld(true);
}

export interface HandOpts {
  /** Finger curl in radians: 0 flat, ~1.1 a closed fist. */
  gripL?: number;
  gripR?: number;
  /** World direction each palm should face. */
  palmL?: THREE.Vector3;
  palmR?: THREE.Vector3;
}

/**
 * A pose expressed purely as world-space directions. This is the common
 * currency: it can come from the procedural driver rig or from a motion clip
 * baked off a completely different skeleton, and the renderer can't tell.
 */
export interface PoseDirs {
  /** hips -> chest */
  up: THREE.Vector3;
  /** chest -> head */
  neck: THREE.Vector3;
  /** the skull's own long axis */
  headUp: THREE.Vector3;
  /**
   * Where the face points. Aiming the head fixes only its up axis and leaves
   * the yaw undefined, so without this a batter watches the pitch from
   * whichever direction the maths happened to leave him facing.
   */
  headLook: THREE.Vector3;
  /** left hip -> right hip */
  hipLine: THREE.Vector3;
  /** left shoulder -> right shoulder */
  shoulderLine: THREE.Vector3;
  /** target bone name -> the direction it should point */
  limbs: Record<string, THREE.Vector3>;
}

export function retargetDirs(bones: BoneMap, d: PoseDirs, hands?: HandOpts) {
  if (bones.pelvis) {
    aim(bones.pelvis, d.up);
    if (bones.thigh_l && bones.thigh_r) {
      roll(bones.pelvis, d.up, bones.thigh_l, bones.thigh_r, d.hipLine);
    }
  }
  for (const s of SPINE) if (bones[s]) aim(bones[s], d.up);
  if (bones.spine_03 && bones.clavicle_l && bones.clavicle_r) {
    roll(bones.spine_03, d.up, bones.clavicle_l, bones.clavicle_r, d.shoulderLine);
  }

  if (bones.neck_01) aim(bones.neck_01, d.neck);
  if (bones.Head) {
    aim(bones.Head, d.headUp);
    if (d.headLook && d.headLook.lengthSq() > 1e-8) {
      bones.Head.getWorldQuaternion(_q);
      _f.copy(FORWARD).applyQuaternion(_q).normalize();
      rollTo(bones.Head, d.headUp, _f, d.headLook);
    }
  }

  for (const name of Object.keys(d.limbs)) {
    const b = bones[name], dir = d.limbs[name];
    if (b && dir) aim(b, dir);
  }

  if (!hands) return;
  const aimed = (side: "l" | "r") => (d.limbs[`hand_${side}`]?.lengthSq() ?? 0) > 1e-8;
  if (hands.palmL) facePalm(bones, "l", hands.palmL, aimed("l"));
  if (hands.palmR) facePalm(bones, "r", hands.palmR, aimed("r"));
  grip(bones, "l", hands.gripL ?? 0);
  grip(bones, "r", hands.gripR ?? 0);
}

export function emptyDirs(): PoseDirs {
  const dirs: PoseDirs = {
    up: new THREE.Vector3(0, 1, 0),
    neck: new THREE.Vector3(0, 1, 0),
    headUp: new THREE.Vector3(0, 1, 0),
    headLook: new THREE.Vector3(0, 0, 0),
    hipLine: new THREE.Vector3(1, 0, 0),
    shoulderLine: new THREE.Vector3(1, 0, 0),
    limbs: {},
  };
  for (const bone of BONES) {
    // Clavicles and hands start unset — a zero direction means "leave at bind",
    // which aim() skips. Defaulting them to a real direction would aim every
    // pose's shoulders (or hands) whether it asked for that or not. A pose that
    // wants its hands aimed, like the batter gripping a bat, says so.
    const optional = bone.startsWith("clavicle") || bone.startsWith("hand");
    dirs.limbs[bone] = new THREE.Vector3(0, optional ? 0 : -1, 0);
  }
  return dirs;
}


