/**
 * Builds every static pose the game uses, solved on the real glTF skeleton.
 *
 * Reference photographs drove the arm work: in a batting stance the back elbow
 * hangs DOWN near the ribs with the forearm angling up to the hands — it is not
 * cocked out behind. Pole vectors are set to put each elbow there, and the
 * report below checks it (elbow below both the shoulder and the hand).
 *
 *   node tools/pose/build-poses.mjs [--write]
 */
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { solvePose, report, armCheck, dirsToJson, V } from "./solve-pose.mjs";

/* ------------------------------- catcher ---------------------------------- */
/*
 * Authored facing +z for readability, then yawed 180 so he faces the mound at
 * -z like everything else in the scene.
 *
 * This has to be baked in rather than done with a rotated group: a pose is a
 * set of WORLD directions, so a parent rotation moves a model's position but
 * does nothing to its orientation. Wrapping him in a turned group left his hips
 * facing one way and his feet placed the other.
 */
const catcherFacingPlate = {
  pelvis: V(0, 1.42, 0),
  up: V(0, 0.94, 0.34),
  neck: V(0, 0.86, 0.51),
  headUp: V(0, 0.97, -0.24),
  headLook: V(0, -0.18, 1),          // eyes on the mound
  hipLine: V(-1, 0, 0),
  shoulderLine: V(-1, 0, 0),
  feet: {
    l: { target: V(0.84, 0, 0.30), pole: V(0.85, -0.1, 1), toe: V(0.28, 0, 0.96) },
    r: { target: V(-0.84, 0, 0.30), pole: V(-0.85, -0.1, 1), toe: V(-0.28, 0, 0.96) },
  },
  hands: {
    // glove reaches forward; elbow drops below it and stays outside the ribs
    l: { target: V(0.46, 2.42, 1.34), pole: V(0.55, -1, -0.15) },
    // throwing hand tucks behind the hip, elbow down and back
    r: { target: V(-0.55, 1.88, -0.34), pole: V(-0.55, -1, -0.35) },
  },
  grip: { gripL: 0.35, gripR: 0.95 },
};

/** Yaw every vector in a spec about Y. */
function yawSpec(spec, angle) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  const turn = (v) => (v instanceof THREE.Vector3 ? v.clone().applyQuaternion(q) : v);
  const walk = (o) => {
    if (o instanceof THREE.Vector3) return turn(o);
    if (o && typeof o === "object") {
      const out = Array.isArray(o) ? [] : {};
      for (const k of Object.keys(o)) out[k] = walk(o[k]);
      return out;
    }
    return o;
  };
  return walk(spec);
}

const catcher = yawSpec(catcherFacingPlate, Math.PI);

/* -------------------------------- batter ---------------------------------- */
// Local frame IS world: a right-handed hitter stands at -x facing +x, so his
// left shoulder is toward the mound (-z) and his right toward the catcher (+z).
// Solved for a RHB; the lefty gets the mirror at runtime.
/**
 * Barrel direction for a right-handed hitter, near vertical and tipped back
 * over the rear shoulder. Shared with the renderer through poses.json so the
 * bottom hand and the bat itself can't drift apart.
 */
const BAT_AIM = V(-0.13, 0.90, 0.42).normalize();   // ~28 deg off vertical
/**
 * Gap between the two hands along the handle. Kept tight because the solver
 * targets the WRIST while the palm sits a further ~0.3 ft along the fingers —
 * space them by a realistic hand's width and the lower palm ends up past the
 * knob, holding air below the bat.
 */
const GRIP_SPAN = 0.13;
/*
 * Which way the knuckles point, and which way the palms face.
 *
 * Both are derived from BAT_AIM rather than typed in, so they stay square to
 * the barrel if the barrel ever moves. The hands sit on the handle a fist's
 * width off the wrist line, so the knuckles point across the bat — roughly out
 * toward the plate — and the palms face along the direction the fingers close.
 *
 * Before this existed nothing aimed the hand bones at all: they kept whatever
 * twist the forearm IK happened to leave, which put the two hands 62 degrees
 * apart on a bat they are both supposed to be gripping.
 */
const perpToBat = (v) => v.clone().addScaledVector(BAT_AIM, -v.dot(BAT_AIM)).normalize();
/** Knuckles across the barrel, angled out toward the plate and slightly down. */
const BAT_KNUCKLES = perpToBat(V(1, -0.25, -0.15));
/** Palm faces the way the fingers close: square to both the barrel and the knuckles. */
const BAT_PALM = new THREE.Vector3().crossVectors(BAT_AIM, BAT_KNUCKLES).normalize();

function batter({ crouch, coil, handUp, handBack, handOut, headYaw, front, back, shift }) {
  const rearShoulder = (by, P) => P(by.upperarm_r);
  const topHand = (by, P) => rearShoulder(by, P).clone().add(V(handOut, handUp, handBack));
  return {
    // Low enough that the knees actually flex. The legs go straight at ~2.86 —
    // the feet are 2.1 ft apart, which eats most of the leg length.
    /*
     * Hips ride back over the rear leg, which is what makes the front leg
     * extend nearly straight and the back leg carry the bend — the stride
     * position, rather than a symmetric two-footed stance.
     */
    pelvis: V(0, 2.76 - crouch, shift),
    up: V(0.04, 0.999, 0),
    neck: V(0.02, 0.99, -0.08),
    headUp: V(-0.26 + headYaw, 0.95, -0.16),
    // chin over the front shoulder, watching the pitcher
    headLook: V(0.18, -0.08, -1),
    // Negative x closes the stance: the FRONT shoulder turns in toward the
    // plate. Positive swings it behind the body's centreline, which leaves the
    // front arm no way to reach the handle except straight through his chest.
    hipLine: V(-0.10, 0, 1),
    shoulderLine: V(-coil, 0, 1),
    /*
     * Reaches are measured from the pelvis, because that is what the leg has to
     * span. Set them as absolute positions and a wide stance quietly exceeds the
     * leg's length — IK then clamps it straight and leaves the foot hanging in
     * the air, which is exactly what happened at 1.62 ft of stride.
     */
    feet: {
      l: { target: V(0.06, 0, shift - front), pole: V(1, -0.25, -0.5), toe: V(0.92, 0, -0.4) },
      r: { target: V(-0.02, 0, shift + back), pole: V(1, -0.3, 0.45), toe: V(0.84, 0, 0.54) },
    },
    /*
     * Hand height decides whether the back elbow can hang.
     *
     * The elbow sits on a circle perpendicular to the shoulder-to-hand line. If
     * the hands are high and close, that line points steeply up, "down" is
     * almost parallel to it, and the furthest-down point on the circle is still
     * level with the shoulder — the elbow ends up BEHIND instead, and the arm
     * reads as one straight limb folded back on itself. Dropping the hands to
     * about chin height and setting them further back tilts the line toward
     * horizontal, and the elbow can finally drop where a real one does.
     */
    /*
     * The front shoulder draws round toward the hands, the way a coiled hitter's
     * does. Without it the front arm has to lock straight to reach the handle.
     */
    /*
     * A clavicle protracts an inch or two, not six. Shoving the shoulder far
     * enough to buy the front arm reach tears it visibly off the torso, so the
     * reach comes from where the hands are instead and this stays subtle.
     *
     * The front one carries about three inches, which is the top of that range
     * and deliberate: at 0.16 out and 0.10 back the upper arm crossed the chest
     * 0.52 ft from the spine, inside the 0.55 ft ribcage that check-clip.mjs
     * models. Squaring the shoulder (z to 0) and easing it out to 0.24 lifts all
     * three batter poses to 0.57-0.58 without touching the hands, so the grip
     * the bat was fitted to is unchanged.
     */
    clavicles: {
      l: (by, P) => P(by.upperarm_l).clone().add(V(0.24, -0.02, 0.00)),
      r: (by, P) => P(by.upperarm_r).clone().add(V(0.02, 0, -0.06)),
    },
    hands: {
      r: {
        target: topHand,
        pole: V(0.10, -1, 0.05),
        // Both hands take the SAME knuckle direction — they are on one bat.
        knuckles: BAT_KNUCKLES,
      },
      l: {
        // Down the handle from the top hand, so both hands are on the bat by
        // construction rather than by two offsets that happen to agree.
        target: (by, P) => topHand(by, P).addScaledVector(BAT_AIM, -GRIP_SPAN),
        /*
         * Slightly further down and forward than the obvious pole: it keeps the
         * front elbow hanging (0.42 below the shoulder) while moving the upper
         * arm off the ribs. Poles that buy clearance by swinging the elbow up
         * hit 0.58 too, but at 0.20 below the shoulder — a chicken wing.
         */
        pole: V(0.9, -0.95, -0.35),
        knuckles: BAT_KNUCKLES,
      },
    },
    grip: { gripL: 1.05, gripR: 1.05, palmL: BAT_PALM, palmR: BAT_PALM },
  };
}

const POSES = {
  catcherCrouch: catcher,
  batterStance: batter({ crouch: 0.34, coil: 0.22, handUp: 0.15, handBack: 0.25, handOut: 0.82, headYaw: 0, front: 1.66, back: 1.00, shift: 0.24 }),
  batterLoad: batter({ crouch: 0.40, coil: 0.32, handUp: 0.19, handBack: 0.33, handOut: 0.78, headYaw: 0.04, front: 1.68, back: 1.02, shift: 0.29 }),
  batterTake: batter({ crouch: 0.31, coil: 0.16, handUp: 0.13, handBack: 0.21, handOut: 0.85, headYaw: -0.03, front: 1.64, back: 0.99, shift: 0.21 }),
};

const out = {};
for (const [name, spec] of Object.entries(POSES)) {
  const { dirs, by } = solvePose(spec);
  const bat = name.startsWith("batter")
    ? {
        batAim: [+BAT_AIM.x.toFixed(3), +BAT_AIM.y.toFixed(3), +BAT_AIM.z.toFixed(3)],
        // The renderer has to twist the hands the same way the solver did, or
        // the grip it measured is not the grip that gets drawn.
        palm: [+BAT_PALM.x.toFixed(3), +BAT_PALM.y.toFixed(3), +BAT_PALM.z.toFixed(3)],
      }
    : {};
  out[name] = { ...bat, ...dirsToJson(dirs), pelvis: [+spec.pelvis.x.toFixed(3), +spec.pelvis.y.toFixed(3), +spec.pelvis.z.toFixed(3)] };
  report(by, name);
  console.log("  arm L", JSON.stringify(armCheck(by, "l")));
  console.log("  arm R", JSON.stringify(armCheck(by, "r")));
}

if (process.argv.includes("--write")) {
  writeFileSync("src/scene/poses.json", JSON.stringify(out, null, 1));
  console.log("\nwrote src/scene/poses.json");
}
