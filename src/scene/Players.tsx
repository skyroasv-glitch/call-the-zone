import { useMemo, useRef, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Quaternion, Vector3, type Group, type Mesh, type Object3D } from "three";

import { RUBBER_Z, type AnimState } from "./anim";
import { RELEASE_Z } from "../game/trajectory";
import { sampleThrow, sampleHips, newThrowDirs, THROW } from "./throwClip";
import { PlayerModel, BoneAttach } from "./PlayerModel";
import { placeInParent } from "./attach";
import type { Skin } from "./uniform";
import { Cap, Helmet, CatcherMask } from "./Gear";
import { reachArm, type BoneMap, type HandOpts, type PoseDirs } from "./retarget";
import { readPose, blendPoses, pelvisOf, batAimOf, palmOf, emptyDirs } from "./poses";


/* ---------------------------------- pitcher --------------------------------- */
/*
 * The pitcher plays a real motion-captured ball throw (see tools/pose/bake-throw.mjs),
 * baked down to per-frame bone directions so the same retargeter that drives the
 * solved poses can play it.
 *
 * Two things have to be reconciled with the geometry the game is built on:
 *
 *  - Release height. At the release frame the mannequin's hand sits 6.81 ft up,
 *    while trajectory() launches the ball from 6.1 ft. Rather than bend the
 *    trajectory maths — it decides the call — the pitcher is scaled to fit it,
 *    which keeps his feet on the ground and his hand on the ball.
 *  - The stride. The source clip throws on the spot: the hips travel barely a
 *    foot. A pitcher covers about six. So the body is carried from the rubber to
 *    the release point over the wind-up, on top of whatever the clip's own hips
 *    do. At 60 ft away this reads as a stride; up close his feet would skate.
 */

/** Throwing hand at the release frame, relative to the model root, at MODEL_SCALE. */
const RELEASE_HAND = { x: 1.605, y: 6.811, z: -0.444 };
/** trajectory()'s release height and arm side. */
const RELEASE_Y = 6.1, RELEASE_X = 1.9;
const MODEL_SCALE = 3.0 / 0.83;
/** Shrink until the hand lands exactly on the trajectory's release height. */
const FIT = RELEASE_Y / RELEASE_HAND.y;
const PITCHER_SCALE = MODEL_SCALE * FIT;

/** Throwing hand wraps the ball; glove hand stays loosely closed. */
const PITCHER_HANDS_R: HandOpts = { gripR: 0.9, gripL: 0.6 };
const PITCHER_HANDS_L: HandOpts = { gripL: 0.9, gripR: 0.6 };

const smoothstep = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

export function Pitcher({ anim, hand, handRef, skin }: {
  anim: RefObject<AnimState>;
  hand: "R" | "L";
  handRef: RefObject<Object3D | null>;
  skin: Skin;
}) {
  const mirror = hand === "L";
  const head = useRef<Object3D | null>(null);
  const side = mirror ? 1 : -1;

  const dirs = useRef<PoseDirs>(newThrowDirs());
  const position = useRef(new Vector3());
  const hips = useMemo(() => new Vector3(), []);

  // Where he must stand for the hand to reach the trajectory's release point,
  // and where he starts from on the rubber.
  const release = useMemo(
    () => new Vector3(
      side * RELEASE_X - side * RELEASE_HAND.x * FIT,
      0,
      RELEASE_Z - RELEASE_HAND.z * FIT,
    ),
    [side],
  );
  const start = useMemo(
    () => new Vector3(side * 0.35, 0, RUBBER_Z),
    [side],
  );

  useFrame(() => {
    const a = anim.current;
    const t = a.released
      ? THROW.releaseTime + Math.min(a.flight, 1) * (THROW.duration - THROW.releaseTime)
      : a.windup * THROW.releaseTime;

    sampleThrow(t, mirror, dirs.current);
    sampleHips(t, mirror, hips).multiplyScalar(FIT);

    const stride = smoothstep(t / THROW.releaseTime);
    position.current.lerpVectors(start, release, stride).add(hips);
  });

  return (
    <>
      <PlayerModel
        dirsRef={dirs}
        positionRef={position}
        scale={PITCHER_SCALE}
        skin={skin}
        handBone={mirror ? "hand_l" : "hand_r"}
        handRef={handRef}
        headRef={head}
        hands={mirror ? PITCHER_HANDS_L : PITCHER_HANDS_R}
      />
      <BoneAttach target={head}><Cap skin={skin} /></BoneAttach>
    </>
  );
}

/* ---------------------------------- batter ---------------------------------- */
/*
 * Solved on the real glTF skeleton by tools/pose/build-poses.mjs, so what the
 * solver measured is what gets drawn — no stand-in rig with invented bone
 * lengths in between. Authored for a right-handed hitter standing at -x facing
 * the plate; the lefty is the mirror.
 */
/**
 * A real 33-inch bat, converted from the FBX pack by tools/fbx-to-glb.mjs. Its
 * knob sits at the model origin and the barrel runs up +y, which is the axis
 * BatGrip aims — so it needs no rotation of its own, only dropping far enough
 * that the knob clears the bottom hand. BatGrip hangs it off the wrist
 * midpoint, so this drop is measured from there: it leaves 1.9 in of handle
 * below the bottom wrist.
 */
const BAT_URL = `${import.meta.env.BASE_URL}models/bat.glb`;
const BAT_DROP = -0.22;

function Bat() {
  const { scene } = useGLTF(BAT_URL);
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.traverse((o) => { if ((o as Mesh).isMesh) o.castShadow = true; });
    return m;
  }, [scene]);
  return <primitive object={model} position={[0, BAT_DROP, 0]} />;
}
useGLTF.preload(BAT_URL);

/** Hand bones sit at the wrist; the grip is further along the fingers. */
const MITT_OFFSET = new Vector3(0, 0.34, 0.06);

/**
 * How far off the wrist line the bat rides, so it runs through the fists
 * rather than through the wrist joints themselves.
 */
const FIST_SHIFT = 0.11;

const _top = new Vector3(), _bot = new Vector3(), _mid = new Vector3();
const _ax = new Vector3(), _up = new Vector3(), _q = new Quaternion();

/**
 * Places the bat from BOTH hands.
 *
 * The solver puts the bottom wrist exactly `GRIP_SPAN` down `batAim` from the
 * top one, so the line through the two wrists IS the bat's axis — that much is
 * guaranteed by construction. What is not guaranteed is either hand's twist:
 * in batterStance the two hand bones' own +y axes are 62 degrees apart, so
 * offsetting each along its own axis (as a one-bone attachment must) threw the
 * bottom palm 3.7 in off the bat and left that hand holding air.
 *
 * So the bat is hung off the wrist midpoint instead and shifted into the fists
 * along the two hands' averaged axis. Both hands then sit the same distance
 * from the barrel, whatever their twist. `tools/pose/check-grip.mjs` measures
 * this — run it after touching the batter poses.
 */
function BatGrip({ topRef, bottomRef, aim, children }: {
  topRef: RefObject<Object3D | null>;
  bottomRef: RefObject<Object3D | null>;
  aim: Vector3;
  children: ReactNode;
}) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const g = group.current, top = topRef.current, bottom = bottomRef.current;
    if (!g || !top) return;

    top.getWorldPosition(_top);
    if (bottom) {
      bottom.getWorldPosition(_bot);
      _mid.copy(_top).add(_bot).multiplyScalar(0.5);
    } else {
      _mid.copy(_top);
    }

    // Averaged hand axis, with the component along the barrel removed: sliding
    // the bat along its own axis would only change where the knob sits.
    _ax.set(0, 1, 0).applyQuaternion(top.getWorldQuaternion(_q));
    if (bottom) {
      _ax.add(_up.set(0, 1, 0).applyQuaternion(bottom.getWorldQuaternion(_q)));
    }
    _ax.addScaledVector(aim, -_ax.dot(aim));
    if (_ax.lengthSq() > 1e-6) _mid.addScaledVector(_ax.normalize(), FIST_SHIFT);

    _q.setFromUnitVectors(_up.set(0, 1, 0), aim);
    placeInParent(g, _mid, _q);
  });
  return <group ref={group}>{children}</group>;
}
/*
 * Curl plus the palm twist the poses were solved with. Both hands take the same
 * palm: they are on one bat, and leaving the twist to fall out of the forearm
 * IK is what had them pointing 62 deg apart.
 */
function batterGrip(mirror: boolean): HandOpts {
  const palm = palmOf("batterStance", mirror, new Vector3());
  return { gripL: 1.05, gripR: 1.05, palmL: palm, palmR: palm };
}

export function Batter({ anim, bats, skin }: {
  anim: RefObject<AnimState>; bats: "R" | "L"; skin: Skin;
}) {
  const head = useRef<Object3D | null>(null);
  // RHB stands in the third-base box, which is -x from behind the plate.
  const side = bats === "R" ? -1 : 1;
  const mirror = bats === "L";
  const dirs = useRef<PoseDirs>(emptyDirs());
  const batHand = useRef<Object3D | null>(null);
  const offHand = useRef<Object3D | null>(null);
  const pelvis = useRef(pelvisOf("batterStance", mirror, new Vector3()));

  /*
   * Read from the pose rather than declared here: the solver places the bottom
   * hand along this axis, so a second copy that drifts leaves a hand off the bat.
   */
  const batAim = useMemo(
    () => batAimOf("batterStance", mirror, new Vector3()), [mirror]);
  const grip = useMemo(() => batterGrip(mirror), [mirror]);

  useFrame(() => {
    const a = anim.current;
    const t = a.released ? 1 + Math.min(a.flight, 1) : a.windup;
    // stance -> load through the wind-up, then settle into the take
    if (t <= 1) blendPoses("batterStance", "batterLoad", t, mirror, dirs.current);
    else blendPoses("batterLoad", "batterTake", Math.min((t - 1) / 0.35, 1), mirror, dirs.current);
    pelvisOf(t <= 1 ? "batterStance" : "batterTake", mirror, pelvis.current);
  });

  return (
    <group position={[side * 2.85, 0, 0.55]}>
      <PlayerModel dirsRef={dirs} pelvisRef={pelvis} skin={skin}
                   handBone={bats === "R" ? "hand_r" : "hand_l"} handRef={batHand}
                   offHandBone={bats === "R" ? "hand_l" : "hand_r"} offHandRef={offHand}
                   headRef={head} hands={grip} />
      <BoneAttach target={head}><Helmet skin={skin} bats={bats} /></BoneAttach>
      <BatGrip topRef={batHand} bottomRef={offHand} aim={batAim}>
        <Bat />
      </BatGrip>
    </group>
  );
}

/* --------------------------------- catcher ---------------------------------- */
/** How far the catcher fades once the ball is released. */
const GHOST = 0.16;
/** Where the mitt receives the ball, feet behind the tip of the plate. */
const RECEIVE_Z = 0.55;
/** Glove elbow drops below and outside the wrist, as a receiving arm does. */
const GLOVE_POLE = new Vector3(0.55, -1, -0.15).normalize();

const CATCHER_HANDS: HandOpts = {
  gripL: 0.35, gripR: 0.95,
  palmL: new Vector3(0, 0.25, -1).normalize(),
  palmR: new Vector3(0, -1, -0.3).normalize(),
};

export function Catcher({ anim, target, skin }: {
  anim: RefObject<AnimState>;
  target: [number, number];
  skin: Skin;
}) {
  const head = useRef<Object3D | null>(null);
  const dirs = useRef<PoseDirs>(readPose("catcherCrouch", false, emptyDirs()));
  const pelvis = useRef(pelvisOf("catcherCrouch", false, new Vector3()));
  const mitt = useRef<Object3D | null>(null);
  const fade = useRef(1);
  const rest = useMemo(() => new Vector3(), []);
  const want = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    // He sits between the camera and the plate, so he fades out of the way
    // once the ball is on its way — the call has to stay readable.
    const to = anim.current.released ? GHOST : 1;
    fade.current += (to - fade.current) * Math.min(dt * 9, 1);
  });

  /*
   * Reach for the pitch with real IK rather than nudging the shoulder angles and
   * hoping. The mitt rides the hand bone, so moving the hand moves the mitt —
   * which is the only way it stays attached to the wrist.
   */
  const reach = (bones: BoneMap) => {
    const k = Math.min(Math.max((anim.current.flight - 0.35) / 0.65, 0), 1);
    if (k <= 0) return;
    const hand = bones.hand_l;
    if (!hand) return;
    hand.getWorldPosition(rest);
    want.set(target[0], target[1], RECEIVE_Z).sub(rest).clampLength(0, 1.1)
      .multiplyScalar(k).add(rest);
    reachArm(bones, "l", want, GLOVE_POLE);
  };

  return (
    <group position={[0, 0, 2.6]}>
      <PlayerModel dirsRef={dirs} pelvisRef={pelvis} skin={skin}
                   handBone="hand_l" handRef={mitt} opacityRef={fade}
                   headRef={head} hands={CATCHER_HANDS} postPose={reach} />
      {/* fades with its wearer, or the mask would hang in the air over a ghost */}
      <BoneAttach target={head} opacityRef={fade}><CatcherMask skin={skin} /></BoneAttach>
      <BoneAttach target={mitt} opacityRef={fade} offset={MITT_OFFSET}>
        <mesh castShadow scale={[1, 1, 0.7]}>
          <sphereGeometry args={[0.44, 14, 10]} />
          <meshStandardMaterial color="#7b4a26" roughness={0.7} transparent opacity={1} />
        </mesh>
      </BoneAttach>
    </group>
  );
}
