import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Everything beyond the diamond: sky, outfield wall, stands, light towers.
 *
 * All of it is cheap on purpose — the camera sits behind the plate at a 38-degree
 * FOV, so this is scenery a few hundred feet away. Big shapes, low segment
 * counts, and one small noise texture for the crowd.
 */

/** Home plate is the origin; centre field runs toward -z. */
const WALL_R = 360, WALL_H = 9;
const FAIR_START = Math.PI * 0.75, FAIR_LEN = Math.PI * 0.5;

function makeRand(initial: number) {
  let seed = initial;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

function GradientSky() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color("#04070d") },
      horizon: { value: new THREE.Color("#1d2f45") },
      glow: { value: new THREE.Color("#3a4a5e") },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 glow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        // deep overhead, lifting toward the horizon, with a wash of light
        // spilling up off the stadium itself
        vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55));
        c += glow * pow(clamp(1.0 - abs(h) * 3.2, 0.0, 1.0), 2.0) * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }), []);

  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry args={[900, 24, 16]} />
    </mesh>
  );
}

/** Mottled dark texture that reads as a packed crowd from a long way off. */
function useCrowdTexture() {
  return useMemo(() => {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    // deterministic: no Math.random, so the crowd looks the same every load
    const rand = makeRand(1337);
    for (let i = 0; i < size * size; i++) {
      const x = i % size, y = (i / size) | 0;
      const warm = rand();
      let v = 58 + rand() * 105;
      // aisles every eighth column, and the odd block of empty seats
      if (x % 8 === 0) v *= 0.35;
      if (rand() > 0.982) v *= 0.3;
      // upper rows fall into shadow under the roof
      v *= 0.72 + (y / size) * 0.45;
      data[i * 4 + 0] = v * (0.8 + warm * 0.5);
      data[i * 4 + 1] = v * (0.8 + warm * 0.3);
      data[i * 4 + 2] = v * (0.9 + rand() * 0.4);
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(60, 3);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

/** Pad seams every few feet, with a painted distance marker or two. */
function useWallTexture() {
  return useMemo(() => {
    const w = 1024, h = 64;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#16351f"; g.fillRect(0, 0, w, h);
    // vertical seams between pads
    g.strokeStyle = "#0d2415"; g.lineWidth = 2;
    for (let x = 0; x < w; x += 26) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    g.fillStyle = "#0b1d12"; g.fillRect(0, h - 5, w, 5);
    // distances, spaced the way a real wall carries them
    g.fillStyle = "#e8eef4";
    g.font = "bold 34px ui-monospace, monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    [["330", 0.07], ["375", 0.27], ["401", 0.5], ["375", 0.73], ["330", 0.93]]
      .forEach(([label, at]) => g.fillText(label as string, (at as number) * w, h / 2));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);
}

/** Blocks of muted colour that read as hoardings along the wall. */
function useAdTexture() {
  return useMemo(() => {
    const w = 128, h = 8;
    const data = new Uint8Array(w * h * 4);
    const rand = makeRand(90210);
    const palette = [
      [38, 54, 78], [96, 40, 42], [40, 66, 52],
      [82, 70, 34], [30, 38, 52], [66, 58, 80],
    ];
    for (let x = 0; x < w; x++) {
      const panel = palette[Math.floor(rand() * palette.length) % palette.length];
      const wide = 4 + Math.floor(rand() * 5);
      for (let k = 0; k < wide && x + k < w; k++) {
        for (let y = 0; y < h; y++) {
          const i = (y * w + x + k) * 4;
          // a bright sliver at each panel's edge suggests lit signage
          const edge = k === 0 ? 1.9 : 1;
          data[i] = Math.min(255, panel[0] * edge);
          data[i + 1] = Math.min(255, panel[1] * edge);
          data[i + 2] = Math.min(255, panel[2] * edge);
          data[i + 3] = 255;
        }
      }
      x += wide - 1;
    }
    const tex = new THREE.DataTexture(data, w, h);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

/**
 * Camera flashes going off round the bowl. Each quad blinks on for a frame or
 * two on its own schedule — the single cheapest thing that makes a night crowd
 * feel populated rather than painted on.
 */
function CameraFlashes({ count = 18 }: { count?: number }) {
  const group = useRef<THREE.Group>(null);
  // strobing lights are exactly what this preference is for
  const reduce = useMemo(
    () => typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const spots = useMemo(() => {
    const rand = makeRand(24601);
    return Array.from({ length: count }, () => {
      // biased toward centre field, where the camera is actually looking
      const a = Math.PI + (rand() - 0.5) * 2.4;
      const r = 396 + rand() * 62;
      return {
        pos: [Math.sin(a) * r, 10 + rand() * 46, Math.cos(a) * r] as [number, number, number],
        next: rand() * 6,
        period: 3 + rand() * 9,
      };
    });
  }, [count]);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g || reduce) return;
    const t = clock.elapsedTime;
    g.children.forEach((child, i) => {
      const s = spots[i];
      if (t > s.next) s.next = t + s.period * (0.4 + Math.random());
      // visible only in the ~90 ms right after firing
      child.visible = t > s.next - 0.09 && t < s.next;
    });
  });

  if (reduce) return null;

  return (
    <group ref={group}>
      {spots.map((s, i) => (
        <mesh key={i} position={s.pos} visible={false}>
          <planeGeometry args={[7, 7]} />
          <meshBasicMaterial
            color="#ffffff" transparent opacity={0.85}
            blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export interface Count { balls: number; strikes: number; outs: number }

/**
 * The board is drawn to a canvas rather than assembled from meshes: a line
 * score is dozens of little glyphs, and one texture is far cheaper than the
 * geometry would be. Ball/strike/out lamps track the live count.
 */
function useScoreboardTexture(count: Count) {
  return useMemo(() => {
    const w = 512, h = 158;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (!g) return null;

    g.fillStyle = "#080c12"; g.fillRect(0, 0, w, h);

    const cols = 12, x0 = 96, cw = 30;
    g.font = "bold 17px ui-monospace, monospace";
    g.textAlign = "center"; g.textBaseline = "middle";

    // inning header
    g.fillStyle = "#5f6a7a";
    for (let i = 1; i <= 9; i++) g.fillText(String(i), x0 + (i - 0.5) * cw, 22);
    g.fillStyle = "#8b95a6";
    ["R", "H", "E"].forEach((t, i) => g.fillText(t, x0 + (9.5 + i) * cw, 22));

    // two rows of innings
    const lines = [
      { team: "AWAY", runs: [0, 1, 0, 0, 2, 0, 0, 1, 0], total: [4, 8, 0] },
      { team: "HOME", runs: [1, 0, 0, 3, 0, 0, 1, 0, null], total: [5, 9, 1] },
    ];
    lines.forEach((line, r) => {
      const y = 56 + r * 34;
      g.textAlign = "left";
      g.fillStyle = "#d8e0ea";
      g.fillText(line.team, 12, y);
      g.textAlign = "center";
      g.fillStyle = "#9ed37a";
      line.runs.forEach((v, i) => {
        if (v !== null) g.fillText(String(v), x0 + (i + 0.5) * cw, y);
      });
      g.fillStyle = "#f0d98a";
      line.total.forEach((v, i) => g.fillText(String(v), x0 + (9.5 + i) * cw, y));
    });
    void cols;

    // ball / strike / out lamps
    const lamps: Array<[string, number, number]> = [
      ["B", count.balls, 3], ["S", count.strikes, 2], ["O", count.outs, 2],
    ];
    let ly = 116;
    g.textAlign = "left";
    lamps.forEach(([label, on, total]) => {
      g.fillStyle = "#7d8798";
      g.font = "bold 15px ui-monospace, monospace";
      g.fillText(label, 14, ly);
      for (let i = 0; i < total; i++) {
        const lit = i < on;
        g.beginPath();
        g.arc(40 + i * 22, ly, 8, 0, Math.PI * 2);
        g.fillStyle = lit
          ? (label === "B" ? "#6ec96e" : label === "S" ? "#e0b64a" : "#d05a4a")
          : "#1b2430";
        g.fill();
      }
      ly += 0; // lamps share a row, offset horizontally below
      g.translate(112, 0);
    });
    g.setTransform(1, 0, 0, 1, 0, 0);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [count.balls, count.strikes, count.outs]);
}

function LightTower({ angle }: { angle: number }) {
  const x = Math.sin(angle) * 630, z = Math.cos(angle) * 630;
  return (
    <group position={[x, 0, z]} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, 66, 0]}>
        <cylinderGeometry args={[1.6, 2.6, 132, 6]} />
        <meshStandardMaterial color="#141b24" roughness={1} />
      </mesh>
      {/* bank of lamps, emissive rather than lit — actual lights here would
          cost far more than they'd show at this distance */}
      <mesh position={[0, 138, 1.5]}>
        <boxGeometry args={[30, 12, 1.5]} />
        <meshStandardMaterial
          color="#fdf6df" emissive="#fdf2cf" emissiveIntensity={2.4} toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 138, 0]}>
        <boxGeometry args={[32, 14, 1]} />
        <meshStandardMaterial color="#0d131b" roughness={1} />
      </mesh>
      <mesh position={[0, 138, 3]}>
        <planeGeometry args={[58, 34]} />
        <meshBasicMaterial
          color="#ffeec2" transparent opacity={0.14}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function Stadium({ count }: { count: Count }) {
  const crowd = useCrowdTexture();
  const ads = useAdTexture();
  const wallTex = useWallTexture();
  const board = useScoreboardTexture(count);

  // The board is rebuilt whenever the count changes, so the old GPU texture has
  // to go with it; the rest are built once and released on unmount.
  useEffect(() => () => board?.dispose(), [board]);
  useEffect(() => () => {
    crowd.dispose(); ads.dispose(); wallTex?.dispose();
  }, [crowd, ads, wallTex]);

  return (
    <group>
      <GradientSky />

      {/* outfield wall, fair territory only */}
      <mesh position={[0, WALL_H / 2, 0]} receiveShadow>
        <cylinderGeometry args={[WALL_R, WALL_R, WALL_H, 96, 1, true, FAIR_START, FAIR_LEN]} />
        <meshStandardMaterial map={wallTex} color="#8fa094" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, WALL_H + 0.15, 0]}>
        <cylinderGeometry args={[WALL_R + 0.2, WALL_R + 0.2, 0.5, 64, 1, true, FAIR_START, FAIR_LEN]} />
        <meshStandardMaterial color="#d8c25a" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>

      {/* hoardings across the face of the wall */}
      <mesh position={[0, 4.4, 0]}>
        <cylinderGeometry args={[WALL_R - 0.3, WALL_R - 0.3, 6.4, 64, 1, true, FAIR_START, FAIR_LEN]} />
        <meshStandardMaterial
          map={ads} roughness={1} side={THREE.BackSide}
          emissive="#20252e" emissiveIntensity={0.8}
        />
      </mesh>

      {/* raked bowl of seating, all the way round so orbiting never finds an edge */}
      <mesh position={[0, 34, 0]} frustumCulled={false}>
        <cylinderGeometry args={[476, 388, 68, 72, 1, true]} />
        <meshStandardMaterial
          /* The bowl's inward faces point away from every key light, so it
             carries its own glow instead — a stand full of people under floods
             reads as self-lit at this distance anyway. */
          map={crowd} color="#7d8496" roughness={1} side={THREE.BackSide}
          emissive="#5d6883" emissiveIntensity={1.15}
        />
      </mesh>
      {/* dark facing under the seats, and a shaded lower tier so the bowl
          reads as depth rather than one flat band of light */}
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[388, 380, 12, 72, 1, true]} />
        <meshStandardMaterial color="#10161f" roughness={1} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 20, 0]}>
        <cylinderGeometry args={[406, 388, 28, 72, 1, true]} />
        <meshStandardMaterial
          map={crowd} color="#565f74" roughness={1} side={THREE.BackSide}
          emissive="#2b3546" emissiveIntensity={0.9}
        />
      </mesh>
      <mesh position={[0, 70, 0]}>
        <cylinderGeometry args={[492, 476, 10, 72, 1, true]} />
        <meshStandardMaterial color="#0b1119" roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* an LED ribbon on the facade, and a second deck above it */}
      <mesh position={[0, 72, 0]}>
        <cylinderGeometry args={[478, 478, 4.5, 72, 1, true]} />
        <meshStandardMaterial
          color="#101822" emissive="#2f5a86" emissiveIntensity={1.1}
          roughness={1} side={THREE.BackSide} toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 84, 0]}>
        <cylinderGeometry args={[516, 482, 26, 72, 1, true]} />
        <meshStandardMaterial
          map={crowd} color="#5b6274" roughness={1} side={THREE.BackSide}
          emissive="#3c4557" emissiveIntensity={0.85}
        />
      </mesh>
      <mesh position={[0, 99, 0]}>
        <cylinderGeometry args={[524, 516, 7, 72, 1, true]} />
        <meshStandardMaterial color="#0b1119" roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* pennants along the roof line */}
      {Array.from({ length: 22 }, (_, i) => {
        const a = Math.PI * 0.35 + (i / 21) * Math.PI * 1.3;
        const r = 520;
        return (
          <mesh
            key={i}
            position={[Math.sin(a) * r, 110, Math.cos(a) * r]}
            rotation={[0, a, 0]}
          >
            <planeGeometry args={[9, 13]} />
            <meshStandardMaterial
              color={i % 3 === 0 ? "#c9a23c" : i % 3 === 1 ? "#9aa7bb" : "#7d3f3a"}
              roughness={1} side={THREE.DoubleSide}
              emissive="#2a3140" emissiveIntensity={0.6}
            />
          </mesh>
        );
      })}

      {/* foul poles at the ends of the fair arc */}
      {[FAIR_START, FAIR_START + FAIR_LEN].map((t) => (
        <mesh key={t} position={[Math.sin(t) * WALL_R, 32, Math.cos(t) * WALL_R]}>
          <cylinderGeometry args={[0.8, 0.8, 64, 6]} />
          <meshStandardMaterial
            color="#e8d24a" emissive="#3a3410" emissiveIntensity={0.6} roughness={0.7}
          />
        </mesh>
      ))}

      {/* batter's eye: the dark panel past centre field that gives the hitter a
          background to pick the ball up against */}
      <mesh position={[0, 21, -(WALL_R + 6)]}>
        <boxGeometry args={[92, 26, 3]} />
        <meshStandardMaterial color="#11291a" roughness={1} />
      </mesh>

      {/* scoreboard riding above it */}
      <group position={[0, 52, -(WALL_R + 10)]}>
        <mesh>
          <boxGeometry args={[104, 32, 4]} />
          <meshStandardMaterial color="#0a0f16" roughness={1} />
        </mesh>
        <mesh position={[0, 3, 2.6]}>
          <planeGeometry args={[92, 19]} />
          <meshStandardMaterial
            map={board} color="#ffffff"
            emissiveMap={board} emissive="#ffffff" emissiveIntensity={0.85}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, -12, 2.6]}>
          <planeGeometry args={[96, 3.5]} />
          <meshStandardMaterial
            color="#2a2410" emissive="#c39a2c" emissiveIntensity={0.7} toneMapped={false}
          />
        </mesh>
      </group>

      {/*
        Angles run from +z (behind the plate), so centre field is PI. The camera
        only sees about 31 degrees either side of it — the first pair sit inside
        that, the rest carry the ring round for when you orbit.
      */}
      <CameraFlashes />

      {[Math.PI - 0.34, Math.PI + 0.34, Math.PI - 1.0, Math.PI + 1.0, 0.75, -0.75]
        .map((a) => <LightTower key={a} angle={a} />)}
    </group>
  );
}
