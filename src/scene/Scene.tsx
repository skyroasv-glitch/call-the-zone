import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import type { Object3D, PerspectiveCamera as PerspectiveCameraImpl } from "three";
import { useGame, type Judged } from "../game/store";
import { flightSeconds } from "../game/trajectory";
import type { Pitch } from "../game/types";
import { Field } from "./Field";
import { Stadium } from "./Stadium";
import { StrikeZone } from "./StrikeZone";
import { Ball } from "./Ball";
import { BALL_R } from "../game/rulebook";
import { Pitcher, Batter, Catcher } from "./Players";
import { skinById, awaySkinFor } from "./uniform";
import { FLIGHT_SCALE, WINDUP_SEC, idleAnim, settledAnim, type AnimState } from "./anim";

function Driver({ anim, pitch }: { anim: React.RefObject<AnimState>; pitch: Pitch }) {
  const phase = useGame((s) => s.phase);
  const nonce = useGame((s) => s.replayNonce);
  const arrive = useGame((s) => s.arrive);
  const start = useRef<number | null>(null);
  const dur = flightSeconds(pitch.velo) * FLIGHT_SCALE;

  useEffect(() => { start.current = null; }, [phase, nonce, pitch.id]);

  useFrame(({ clock }) => {
    if (phase !== "pitching") {
      // oxlint-disable-next-line react/immutability -- frame refs are the r3f animation bus, not React state
      anim.current = phase === "ready" ? idleAnim() : settledAnim();
      return;
    }
    if (start.current === null) start.current = clock.elapsedTime;
    const e = clock.elapsedTime - start.current;
    if (e < WINDUP_SEC) {
      // oxlint-disable-next-line react/immutability -- frame refs are the r3f animation bus, not React state
      anim.current = { active: true, windup: e / WINDUP_SEC, flight: 0, released: false, after: 0 };
      return;
    }
    const fl = (e - WINDUP_SEC) / dur;
    if (fl >= 1) {
      // oxlint-disable-next-line react/immutability -- frame refs are the r3f animation bus, not React state
      anim.current = settledAnim();
      arrive();
      return;
    }
    // oxlint-disable-next-line react/immutability -- frame refs are the r3f animation bus, not React state
    anim.current = { active: true, windup: 1, flight: fl, released: true, after: 0 };
  });

  return null;
}

/**
 * Where the five pitches crossed, all against one reference zone. Each pitch
 * has its own szTop/szBot, so heights are normalized into the reference box —
 * a pitch at the letters plots at the letters regardless of whose zone it was.
 */
function Recap({ judged }: { judged: Judged[] }) {
  const top = 3.4, bot = 1.6;
  return (
    <group>
      <StrikeZone szTop={top} szBot={bot} />
      {judged.map((j) => {
        const p = j.pitch;
        const y = bot + ((p.pz - p.szBot) / Math.max(p.szTop - p.szBot, 0.01)) * (top - bot);
        return (
          <group key={p.id} position={[p.px, y, 0]}>
            <mesh>
              <sphereGeometry args={[BALL_R, 16, 12]} />
              <meshStandardMaterial
                color={j.correct ? "#4f9a63" : "#cf6a41"}
                emissive={j.correct ? "#4f9a63" : "#cf6a41"}
                emissiveIntensity={0.45}
                roughness={0.4}
              />
            </mesh>
            {/* faint halo so overlapping pitches stay countable */}
            <mesh>
              <sphereGeometry args={[BALL_R * 1.9, 12, 10]} />
              <meshBasicMaterial
                color={j.correct ? "#4f9a63" : "#cf6a41"}
                transparent opacity={0.16} depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

const BASE_FOV = 38;
const BASE_ASPECT = 16 / 9;
const BASE_POS: [number, number, number] = [0, 5.1, 12.6];

/**
 * Portrait screens have a much narrower horizontal window than the 16:9 the
 * framing was tuned for, which leaves the catcher filling the view. Widen the
 * vertical FOV (capped, before it distorts) and start the camera further back.
 */
function ResponsiveCamera() {
  const cam = useThree((s) => s.camera) as PerspectiveCameraImpl;
  const size = useThree((s) => s.size);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const shortfall = Math.max(BASE_ASPECT / Math.max(aspect, 0.1), 1);

    const half = Math.tan((BASE_FOV * Math.PI) / 360) * shortfall;
    // oxlint-disable-next-line react/immutability -- three.js cameras are configured by mutating the object
    cam.fov = Math.min((Math.atan(half) * 360) / Math.PI, 52);

    if (!placed.current) {
      // One-time dolly: whatever the wider FOV could not recover.
      const widened = Math.tan((cam.fov * Math.PI) / 360) / Math.tan((BASE_FOV * Math.PI) / 360);
      const dolly = Math.min(shortfall / widened, 1.6);
      cam.position.set(BASE_POS[0], BASE_POS[1] * Math.sqrt(dolly), BASE_POS[2] * dolly);
      placed.current = true;
    }
    cam.updateProjectionMatrix();
  }, [cam, size.width, size.height]);

  return null;
}

function PitchScene({ pitch }: { pitch: Pitch }) {
  const anim = useRef<AnimState>(idleAnim());
  const hand = useRef<Object3D | null>(null);
  const phase = useGame((s) => s.phase);
  const showZone = phase === "revealed" || phase === "summary";
  const bats = pitch.stand;
  const homeSkin = skinById(useGame((s) => s.save.skinId));
  const awaySkin = awaySkinFor(homeSkin);

  return (
    <>
      <Driver anim={anim} pitch={pitch} />
      <Field />
      {/* Pitcher and catcher are the same club; the batter is the visiting one. */}
      <Pitcher anim={anim} hand={pitch.hand} handRef={hand} skin={homeSkin} />
      <Batter anim={anim} bats={bats} skin={awaySkin} />
      <Catcher anim={anim} target={[pitch.px, pitch.pz]} skin={homeSkin} />
      <Ball key={pitch.id} pitch={pitch} anim={anim} handRef={hand} />
      {showZone && <StrikeZone szTop={pitch.szTop} szBot={pitch.szBot} />}
    </>
  );
}

/** "3-2, 1 out" -> the lamps on the scoreboard. */
function readCount(situation: string | undefined) {
  const m = /^(\d+)-(\d+),\s*(\d+)/.exec(situation ?? "");
  return m
    ? { balls: +m[1], strikes: +m[2], outs: +m[3] }
    : { balls: 0, strikes: 0, outs: 0 };
}

export function Scene({ pitch, recap }: { pitch: Pitch | null; recap?: Judged[] }) {
  const dpr = useMemo<[number, number]>(() => [1, 2], []);
  const count = useMemo(() => readCount(pitch?.situation), [pitch?.situation]);

  return (
    <Canvas shadows dpr={dpr} gl={{ antialias: true }}>
      {/* fog reaches only far enough to soften the outfield; the sky and the
          stands sit beyond it and are excluded so they stay crisp */}
      <fog attach="fog" args={["#1b2836", 260, 1050]} />

      {/* far has to clear the stadium: the bowl sits 460-490 ft out and the sky
          dome at 900. At the old 400 they were clipped away entirely. */}
      <PerspectiveCamera makeDefault fov={BASE_FOV} position={BASE_POS} near={0.5} far={2400} />
      <ResponsiveCamera />
      {/*
        * The camera stays behind the catcher, where an umpire stands. Orbiting
        * is off entirely rather than clamped: swinging round to the side lets
        * you read the ball's position against the plate from an angle no umpire
        * ever gets, which turns a judgement call into a geometry read. Zoom
        * stays — it moves you along the same sightline rather than off it.
        */}
      <OrbitControls
        target={[0, 3.9, -1.5]}
        enablePan={false}
        enableRotate={false}
        minDistance={6}
        maxDistance={26}
        enableDamping
        dampingFactor={0.08}
      />

      <Stadium count={count} />

      <hemisphereLight args={["#9fc0e8", "#2b3a2a", 0.72]} />
      <directionalLight
        position={[18, 34, 12]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-far={120}
      />
      <directionalLight position={[-22, 28, -40]} intensity={0.7} color="#cfe3ff" />
      {/* spill from the towers out beyond the wall */}
      <directionalLight position={[-40, 60, -160]} intensity={0.5} color="#f4e6c4" />
      <directionalLight position={[40, 60, -160]} intensity={0.5} color="#f4e6c4" />

      {/* the players and the bat stream in from .glb, so they need a boundary */}
      <Suspense fallback={null}>
        {pitch && <PitchScene key={pitch.id} pitch={pitch} />}
      </Suspense>
      {recap && (
        <>
          <Field />
          <Recap judged={recap} />
        </>
      )}
    </Canvas>
  );
}
