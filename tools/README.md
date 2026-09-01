# tools

Small node scripts. They aren't part of the app bundle — they generate or
inspect things that get pasted into it.

## uv-unwrap.mjs

The Quaternius mannequin ships a `TEXCOORD_0` channel in which **every vertex
sits at (0, 1)** — the attribute is there, but it carries no layout, so any
texture samples one texel and comes out flat. That is why the players were solid
colours for so long, and why "just add a texture" does nothing on its own.

This rebuilds the channel as a per-limb cylindrical unwrap: each vertex is
assigned to a body region by its heaviest skin weight, then projected around
that region's own bone axis (u around the limb, v along it) into its own
rectangle of the atlas.

```bash
node tools/uv-unwrap.mjs          # report island sizes
node tools/uv-unwrap.mjs --write  # …and rewrite player.glb + src/scene/uv-atlas.json
```

It is idempotent — UVs are recomputed from `POSITION` every run, never from the
existing channel — so running it twice is the same as running it once.

`--write` also emits `src/scene/uv-atlas.json`, which `src/scene/uniform.ts`
paints into. That file is generated rather than hand-copied because a rect that
moved here and not there would mis-paint silently.

The wrap seam is put on the body's side, where a real jersey's side seam runs.
Vertices are not split across it, so triangles spanning the seam stretch; with
vertical pinstripes that reads as a seam rather than a smear, and the back
number sits a quarter turn away from it. If you ever need a design that crosses
the seam cleanly, that is the point at which vertices have to be duplicated.

## pose/

Every pose in the game is **solved against the real glTF skeleton** and emitted
as bone directions, so what the solver measures is what gets drawn.

| file | what it does |
| --- | --- |
| `pose/ik.mjs` | `aimEuler` (closed-form bone aiming) and `twoBone` (2-bone IK) |
| `pose/solve-pose.mjs` | poses the actual mannequin from foot/hand targets and pole vectors |
| `pose/build-poses.mjs` | the specs — catcher crouch, batter stance/load/take — and writes `src/scene/poses.json` |
| `pose/verify-poses.mjs` | replays `poses.json` through the shipping reader and reports joint positions |
| `pose/check-clip.mjs` | measures each limb segment against the torso, so an arm inside the chest is caught as a number |
| `pose/check-grip.mjs` | measures both hands against the bat's axis, so a hand holding air is caught as a number |

```bash
node tools/pose/build-poses.mjs          # solve and report
node tools/pose/build-poses.mjs --write  # …and write poses.json
node tools/pose/verify-poses.mjs catcherCrouch
```

Clavicles are opt-in: a pose that doesn't name one leaves it at bind. They have
to be, because a zero direction means "don't aim this", and defaulting them to a
real direction aims every pose's shoulders whether it asked or not — which
quietly folded the catcher in half the first time.

```bash
node tools/pose/check-clip.mjs batterStance
node tools/pose/check-grip.mjs batterStance
```

`check-grip.mjs` exists for the same reason, one level up: the bat is not posed
at all. It rides the hands and is aimed down `batAim`, so whether the *other*
hand is actually on it is never stated anywhere — it falls out of the offsets
and the two wrists' own twist. It was wrong for a long time and looked almost
right: the solver guarantees the two WRISTS are collinear with the barrel, but
the renderer hung the bat off a palm, offset along one hand's +y. Those two axes
are 62 degrees apart in the stance, which threw the bottom palm 3.7 in off the
bat. The bat now hangs off the wrist midpoint and shifts into the fists along
the averaged axis, which is symmetric by construction; the tool prints the
asymmetry so a regression is a number, not a squint.

### Aiming hands

Legs have always aimed their feet from `toe`; arms had no equivalent, so hand
bones kept whatever twist the forearm IK left them with. Two hands on one bat
came out **62 degrees apart**. Arms now take `knuckles` the same way, and both
of the batter's hands are given the same direction — derived from `BAT_AIM`, so
it stays square to the barrel if the barrel moves.

Two things make this work, and both are easy to trip over:

- `hand_l` / `hand_r` are **optional** bones in `retarget.ts`, like clavicles: a
  zero direction means "leave at bind". Give them a real default and every pose
  — catcher, pitcher — gets its hands aimed whether it asked or not.
- `facePalm` normally pronates the FOREARM, which drags the hand round with it
  and undoes the aim. When a pose has aimed the hand, the twist is taken about
  the hand's own axis instead. Without that second part the hands stayed 68
  degrees apart even with `knuckles` set, which looks exactly like the aim being
  ignored.

The solved palm ships in `poses.json` next to `batAim`, because the renderer has
to apply the same twist the solver measured or the grip that was checked is not
the grip that gets drawn.

Both take trailing numbers to sweep values before editing the app:

```bash
node tools/pose/check-grip.mjs batterStance 0.11 -0.22   # FIST_SHIFT, BAT_DROP
```

`check-clip.mjs` exists because a limb passing through the ribcage is invisible
in joint coordinates — every angle reads fine, and only the render shows the
forearm buried in the chest. It approximates the torso as a capsule and reports
the closest approach of each bone.

`build-poses.mjs` prints a check per arm — is the elbow below the shoulder, is it
below the hand, what is the interior angle. Those three numbers are what catch a
limb bending the wrong way, which is invisible in a wireframe and obvious the
moment it renders. Reference photographs of real stances set the targets: the
back elbow hangs **down** by the ribs with the forearm angling up to the hands.

A pose is a set of **world** directions. That means you cannot reorient a
character by wrapping it in a rotated group — the group moves its position but
does nothing to its orientation, and the two end up disagreeing. `build-poses`
yaws the catcher's spec before solving instead.

## Motion capture

`pose/bake-throw.mjs` turns a throwing clip into per-frame **bone directions**.
The clip's skeleton shares nothing with the mannequin we render — different bone
names, bind pose and proportions — but the retargeter transfers poses by
direction, so directions are all that need extracting.

```bash
node tools/pose/bake-throw.mjs path/to/HumanM@ThrowBall01_R.fbx src/scene/throw-clip.json
node tools/pose/throw-anchor.mjs        # where the hand sits at release
```

Three things it has to get right, none of them obvious:

- **Z-up.** The clip is authored Z-up, and its root track animates the very node
  FBXLoader uses to correct that — so the correction is silently overwritten the
  moment the mixer runs. It converts explicitly instead.
- **Facing.** Deriving which way the thrower faces from the shoulder line gets
  the sign wrong as easily as right. It calibrates off the motion: find the frame
  where the hand moves fastest and yaw the clip so that velocity points at the
  plate.
- **Release.** The peak-speed frame is the *end* of the fastest segment, by which
  point the arm has whipped through. The ball leaves at the start of it.

`throw-anchor.mjs` imports the shipping `retarget.ts` and `throwClip.ts` and runs
them against the real glb, so the number it reports is what the game will do —
not a re-derivation that can drift.

## Model tools

| file | what it does |
| --- | --- |
| `glbinfo.mjs` | mesh/skin/node counts and clip names; `--tree` prints the node hierarchy with local translations |
| `bind.mjs` | measures a glb's bind pose — bone world positions, limb directions, leg length, overall size |
| `strip-glb.mjs` | drops animation clips and repacks the binary chunk, keeping only accessors still referenced |
| `fbx-to-glb.mjs` | converts a single-mesh FBX prop to a small glb, recentred on its own origin and scaled from centimetres to feet |

```bash
node tools/glbinfo.mjs public/models/player.glb --tree
node tools/bind.mjs public/models/player.glb
node tools/strip-glb.mjs source.glb public/models/player.glb
node tools/fbx-to-glb.mjs "BaseballBat_Raw_Wood(Clean).fbx" public/models/bat.glb
```

`fbxinfo.mjs` carries a small DOM stub so `FBXLoader` runs headless. Any model
that references textures sends it down the ImageLoader path, which wants a real
`<img>` — the stub only has to not throw, since these tools want geometry.

`bind.mjs` is what tells you the numbers the retargeter needs: it reported the
mannequin's leg at 0.83 units against the driver rig's 3.0 ft, which is where
`PlayerModel`'s scale factor comes from.
