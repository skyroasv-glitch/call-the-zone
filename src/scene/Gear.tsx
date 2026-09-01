import type { Skin } from "./uniform";

/**
 * Headgear, built from primitives rather than modelled.
 *
 * Everything is authored in the Head bone's own frame: +y up the skull, +z out
 * through the face, +x to the player's LEFT, origin at the base of the skull.
 * The handedness is not a guess — the skeleton's `_l` bones sit at positive x
 * (upperarm_l x = +0.192, upperarm_r x = -0.192), which is what a model facing
 * +z with +y up implies. The ear flap below depends on getting this right.
 * `BoneAttach` rides the head in world space, so these are feet, not model
 * units — the same reason the bat and mitt keep their own scale.
 *
 * The numbers come from measuring the mesh rather than eyeballing it. Sampling
 * the head-weighted vertices in bands of height gives this profile:
 *
 *     y 0.00 .. 0.85   radius holds at 0.40 - 0.42
 *     y 0.85 .. 0.95   rounds off to 0.20 and ends
 *     half-width  x = 0.31,  half-depth  z = 0.42
 *
 * Two things follow. The head is closer to a capped cylinder than a sphere, so
 * a shell has to clear radius 0.42 or it never surfaces — the first cut of this
 * file used a 0.34 crown, which buried the whole dome inside the skull and
 * showed only in patches, which is what a helmet that "isn't appearing"
 * actually looks like. And the skull is an ellipse from above, a third deeper
 * than it is wide, so every shell is squashed in x to match; a round one reads
 * as a bowling ball balanced on the shoulders.
 *
 * Every material is built transparent even at full opacity: the catcher fades
 * out once the ball is released, and flipping `transparent` on later forces a
 * shader recompile that silently drops the fade.
 */

/** The widest the skull gets. A shell smaller than this is invisible. */
const SKULL_R = 0.42;
/** How much narrower the head is across than front-to-back. */
const SQUASH_X = 0.80;
/** Where the brow sits — the line a cap's brim rides on. */
const BROW_Y = 0.60;

/**
 * Horizontal arc for a mask bar.
 *
 * TorusGeometry lies in the XY plane and sweeps from +x, and it has no
 * thetaStart — so the arc is laid flat by the inner mesh (x rotation) and then
 * spun by the outer group until its midpoint faces +z. Doing it in two nested
 * transforms avoids having to reason about Euler order.
 */
function Bar({ y, radius, arc, tube, color }: {
  y: number; radius: number; arc: number; tube: number; color: string;
}) {
  return (
    <group position={[0, y, 0.10]} rotation={[0, -(Math.PI / 2 - arc / 2), 0]} scale={[SQUASH_X, 1, 1]}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, tube, 6, 20, arc]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.35} transparent opacity={1} />
      </mesh>
    </group>
  );
}

export function Cap({ skin }: { skin: Skin }) {
  const R = SKULL_R + 0.05;
  return (
    <group>
      {/* Crown: sits proud of the skull and sinks into it below the equator. */}
      <mesh castShadow position={[0, BROW_Y, -0.01]} scale={[SQUASH_X, 0.92, 1.05]}>
        <sphereGeometry args={[R, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
        <meshStandardMaterial color={skin.cap} roughness={0.72} transparent opacity={1} />
      </mesh>
      {/* Button on top. */}
      <mesh position={[0, BROW_Y + R * 0.9, -0.01]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial color={skin.trim} roughness={0.6} transparent opacity={1} />
      </mesh>
      {/*
       * Brim as a squashed ellipsoid: the back half hides inside the crown, and
       * it needs no guessing about which way a cylinder's theta sweep starts.
       * It has to start beyond the face (z = 0.41) or it buries itself.
       */}
      <mesh castShadow position={[0, BROW_Y - 0.03, 0.40]} scale={[0.38, 0.03, 0.34]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshStandardMaterial color={skin.cap} roughness={0.6} transparent opacity={1} />
      </mesh>
    </group>
  );
}

export function Helmet({ skin, bats }: { skin: Skin; bats: "R" | "L" }) {
  const R = SKULL_R + 0.08;
  /*
   * A batter takes the pitch side-on, so the ear that faces the mound is the
   * one away from his handedness: a right-hander leads with his left shoulder
   * and wears the flap over his left ear. +x is that side (see above), so a
   * righty flaps at +x and a lefty at -x.
   */
  const flap = bats === "R" ? 1 : -1;
  return (
    <group>
      {/* Shell: thicker than a cap and carried further down the skull. */}
      <mesh castShadow position={[0, BROW_Y - 0.04, -0.02]} scale={[SQUASH_X, 0.96, 1.06]}>
        <sphereGeometry args={[R, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.66]} />
        <meshStandardMaterial color={skin.cap} roughness={0.34} metalness={0.05} transparent opacity={1} />
      </mesh>
      {/* Short stiff brim, lower and blunter than a cap's. */}
      <mesh castShadow position={[0, BROW_Y - 0.10, 0.40]} scale={[0.35, 0.035, 0.26]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshStandardMaterial color={skin.cap} roughness={0.34} transparent opacity={1} />
      </mesh>
      {/* Single flap, over the ear turned toward the pitcher. */}
      <mesh castShadow position={[flap * 0.38, BROW_Y - 0.26, 0.02]} scale={[0.07, 0.20, 0.26]}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshStandardMaterial color={skin.cap} roughness={0.34} transparent opacity={1} />
      </mesh>
    </group>
  );
}

/** Bars are dark metal whatever the kit — a painted cage would read as plastic. */
const CAGE = "#141a21";

export function CatcherMask({ skin }: { skin: Skin }) {
  const R = SKULL_R + 0.08;
  // Brow down to chin. The cage clears the face, which reaches z = 0.41.
  const bars = [0.80, 0.66, 0.52, 0.38, 0.24];

  return (
    <group>
      {/* Helmet shell over the skull. */}
      <mesh castShadow position={[0, BROW_Y - 0.04, -0.03]} scale={[SQUASH_X, 0.98, 1.07]}>
        <sphereGeometry args={[R, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.70]} />
        <meshStandardMaterial color={skin.cap} roughness={0.4} transparent opacity={1} />
      </mesh>

      {/* Cage: horizontals bowed around the face, held by two verticals. */}
      {bars.map((y) => (
        <Bar key={y} y={y} radius={0.40} arc={Math.PI * 0.78} tube={0.017} color={CAGE} />
      ))}
      {[-0.13, 0.13].map((x) => (
        <mesh key={x} castShadow position={[x, 0.52, 0.48]} rotation={[0.06, 0, 0]}>
          <cylinderGeometry args={[0.017, 0.017, 0.60, 6]} />
          <meshStandardMaterial color={CAGE} roughness={0.45} metalness={0.35} transparent opacity={1} />
        </mesh>
      ))}

      {/* Padding where the cage meets brow and chin — the trim colour shows here. */}
      {[0.88, 0.17].map((y) => (
        <mesh key={y} position={[0, y, 0.34]} scale={[0.30, 0.06, 0.10]}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color={skin.trim} roughness={0.85} transparent opacity={1} />
        </mesh>
      ))}
    </group>
  );
}
