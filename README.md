# Call the Zone

A daily "guess the ball/strike" game. Each day you get five curated borderline
pitches, rebuilt in 3D from real Statcast data. You watch the pitch from behind
the plate and call it — then the game reveals two answers: what the **rulebook
(ABS/robot) zone** says, and what the **human umpire actually called**.

You're scored against the rulebook. The fun lives in the pitches where the two
disagree.

Two ways to play, picked from the home screen:

- **Today's Five** — the daily puzzle, same five pitches for everyone, one shot
  a day. Feeds the day streak.
- **Endless Zone** — an infinite shuffled bag drawn from every puzzle on disk,
  with five seconds to call each pitch. Runs go until you end them; only the
  longest correct-call streak is kept.

```bash
npm install
npm run dev
```

That's it — the app ships with real puzzles in `public/puzzles/` and falls back
to a bundled mock set for any date that hasn't been generated yet.

## How a call is decided

`src/game/rulebook.ts` is the single source of truth, and the Python pipeline
carries an identical copy of the same constants:

```
strike  ⟺  |plate_x| ≤ 0.708 + 0.121   and   sz_bot − 0.121 ≤ plate_z ≤ sz_top + 0.121
```

0.708 ft is half of the 17-inch plate; 0.121 ft is a baseball's radius. Any part
of the ball over any part of the zone is a strike, which is why each edge is
padded by one radius.

**The visual and the call use the same box.** The white box is drawn at the true
plate (±0.708) and the ball at its true radius, so "the ball is touching the
line" reads on screen exactly as a strike. Do not pad the drawn box by the ball
radius to match the math — that was the bug that made real strikes look like
balls in the prototype.

The strike zone stays hidden until you've made your call. It reappears on the
reveal, and again on the results screen with all five pitches plotted against
one reference zone.

## Hosting

Deployed on Vercel; `vercel.json` carries the cache rules, which are the part
worth understanding (JSON allows no comments, so they are written down here):

| path | rule | why |
| --- | --- | --- |
| `/assets/*` | `immutable`, 1 year | Vite content-hashes these, so the name changes whenever the bytes do. |
| `/puzzles/*.json` | `max-age=0, must-revalidate` | The daily flips at each player's **local** midnight. A cached copy serves yesterday's five. Revalidation is a 304, so it is nearly free. |
| `/models/*` | `max-age=0, must-revalidate` | Served under fixed names, so they can never be immutable — a new model would never reach anyone holding the old one. |
| `/` | `max-age=0, must-revalidate` | The entry point names the current chunk hashes. Stale HTML is exactly what leaves a tab asking for a chunk that no longer exists. |

There is deliberately **no SPA catch-all rewrite**. Rewriting misses to
`index.html` would turn every absent puzzle file into a 200 serving HTML, and
the loader's content-type check exists precisely because a dev server does that.
Missing files must 404 for the fallback to work.

## When something breaks

`src/ui/ErrorBoundary.tsx` wraps the scene and, as a backstop, the whole app.
The case it exists for is a redeploy: Vite content-hashes every chunk, so once
new files ship the old `Scene-*.js` is gone, and a tab still holding the previous
`index.html` gets a rejected import the first time it opens a pitch. That
unmounts the tree to a blank page, and `lazy()` caches the failed promise so
retrying in place can never work — only a reload does. The boundary recognises
that error and says so, rather than showing a generic failure.

## Layout

```
src/game/       pure TypeScript, no React
  types.ts        Pitch schema (feet, Statcast conventions)
  rulebook.ts     strike/ball geometry — the ground truth
  trajectory.ts   release → plate arc
  store.ts        Zustand state machine + puzzle loading
  daily.ts        local-date puzzle key
  storage.ts      localStorage: streak, history
  share.ts        Wordle-style result grid
src/scene/      react-three-fiber
  Scene.tsx       camera, lights, orbit controls, pitch timeline driver
  Field.tsx       plate, dirt, mound, backstop
  StrikeZone.tsx  the box (only shown after you call it)
  Ball.tsx        code-driven ball + trail
  Rig.tsx         procedural placeholder skeleton
  Players.tsx     pitcher / batter / catcher pose tracks
  Gear.tsx        cap, batting helmet, catcher's mask — primitives on the head bone
  uniform.ts      skin table + the canvas painter for the UV atlas
src/ui/         React: home screen, matchup bar, streak dots, reveal, summary
                skin picker (uniform chooser)
data-pipeline/  Python: Statcast → daily puzzle JSON
public/puzzles/ generated YYYY-MM-DD.json + mock-puzzle.json fallback
```

### Pitch flow

`home` picks the mode, then `ready → pitching → awaiting → revealed` per pitch,
then `summary` (reached at pitch five in daily, or on **End run** in infinite).
In infinite mode `next()` deals the following pitch out of a shuffled bag and
appends it, so `puzzle.pitches` grows as you play and the run recap can still
plot the last twenty. When the bag empties it reshuffles the whole pool, taking
care not to repeat the pitch you just saw. The wind-up
runs for one second, then the ball follows `trajectory()` for a stretched
version of its real flight time (`FLIGHT_SCALE` in `src/scene/anim.ts`).

The ball is always code-driven, never a baked animation path: `trajectory()`
bows the flight below the straight release→plate chord for gravity and breaks it
sideways by pitch type, with both deviations going to zero at the endpoints. It
therefore lands *exactly* on `(px, pz)` — what you see is what the rulebook
judged.

The catcher sits between the camera and the plate, so he fades to 14% opacity
once the ball is released. His materials are built transparent at mount, because
flipping three.js's `transparent` flag later forces a shader recompile and the
fade silently does nothing.

### The call clock

Infinite mode puts `CALL_SECONDS` (5) on each call. The clock starts in
`arrive()` — the moment the ball reaches the plate — never at load or release,
or it would be timing the flight animation and the player's hardware instead of
their judgement. A replay lands back in `revealed`, where the call is already
made, so it is never timed.

`CallTimer` drives the bar straight off the deadline in a rAF loop and writes a
`transform` rather than React state; a countdown re-rendering the tree sixty
times a second would fight the scene for frames. Running out records a `Judged`
entry with `guess: "none"` — scored as a miss, shown as "Out of time".

Replay is refused while a timed call is live (`replay()` in `store.ts`), since a
replay mid-count would be a free pause button. The daily is deliberately
untimed: it is a shared, comparable result, and a clock would score reflexes and
connection speed alongside judgement.

### Daily puzzle + streaks

The puzzle key is the player's **local** date, so it flips at their midnight.
`store.ts` fetches `public/puzzles/<date>.json`; if that's missing it rotates
deterministically through `mock-puzzle.json` using a hash of the date, so
everyone still sees the same five pitches. A dev server answers a missing file
with `index.html`, so the loader checks the content type rather than trusting a
200.

Completion, day streak, and history live in `localStorage` under
`call-the-zone/v1`, alongside the infinite-mode totals (`bestRun`, `runsPlayed`,
`pitchesSeen`). Recording a day is idempotent — replaying won't inflate the
streak.

Infinite mode stocks its pool from `mock-puzzle.json` plus every dated puzzle in
the last three weeks, deduped by pitch id.

A run is banked whenever you leave it — **End run**, the back arrow, or the tab
going away (`pagehide`) — not only on the explicit End run, which used to be the
one route that counted. Banking is by delta: `bankedPitches` tracks what is
already in the lifetime totals, so a tab that is hidden mid-run and then comes
back still totals each pitch once and the run once.

## Controls

`Space` throws · `B` / `S` call it · `R` replays · `Enter` advances · `Esc`
returns to the home screen. On the home screen, `D` starts the daily and `I` the
endless run.
The camera is fixed behind the catcher, where an umpire stands — scroll to zoom
along that sightline, but you cannot orbit off it. Reading the ball against the
plate from the side is a geometry problem rather than a judgement call, and it
is not a view anyone calling a real pitch ever gets.

## Generating real puzzles

See [data-pipeline/README.md](data-pipeline/README.md).

## Solved poses, not eyeballed ones

Joint angles in `Players.tsx` come from the solvers in
[tools/](tools/README.md) — legs swept until the feet land flat, hands placed by
two-bone IK. Re-run them if the rig's proportions change, and read
`tools/README.md` before hand-editing an angle: the two traps here are gimbal
lock in the shoulder and Euler wrap between frames.

## Uniforms

Skins are data, not art assets: `src/scene/uniform.ts` holds a table of
colourways and paints each one onto a canvas at runtime, so adding a kit costs a
few hex codes and no download. That is only possible because
`tools/uv-unwrap.mjs` gave the mesh a real UV layout — the shipped model had a
`TEXCOORD_0` channel with every vertex at (0, 1), which is why the players used
to be flat colours.

The pitcher and catcher wear the kit you pick on the home screen; the batter
wears another one, since he plays for the other club.

Headgear is geometry, not texture — `src/scene/Gear.tsx` builds a cap, a batting
helmet and a catcher's mask from primitives and rides them on the `Head` bone
through `BoneAttach`, the same way the bat and mitt ride the hands. It is
authored in the head bone's own frame (+y up the skull, +z out through the face,
0.63 ft across), so the numbers in that file are feet measured against the real
mesh. The catcher's mask fades with him when he clears the view of the plate.

## Players

The players are a rigged glTF mannequin (CC0, see
[public/models/CREDITS.md](public/models/CREDITS.md)) posed entirely from code.
None of the model's 43 animation clips are used — it ships with them stripped,
which takes it from 7.6 MB to 0.62 MB.

Everything is expressed in one currency: **world-space bone directions**. A pose
is "which way does each bone point", and `retarget.ts` aims the skeleton's bones
to match. Local rotations are never transferred, because they only mean anything
relative to a bind pose and the sources here don't share one.

That gives every player the same runtime path from three very different origins:

| player | pose source |
| --- | --- |
| batter | stances solved by IK (`tools/pose/build-poses.mjs`) |
| catcher | crouch solved by IK, plus live IK so the glove reaches the pitch |
| pitcher | a motion-captured ball throw baked off an unrelated skeleton |

Poses are solved **on the real skeleton**, not a stand-in rig. An earlier version
posed a procedural rig and transferred the result; directions transferred
exactly, but every joint landed about 0.35 ft out because the two skeletons
aren't the same shape. Solving on the actual bones removes that entirely.

### Things that bite

- **Aiming leaves twist undefined.** Invisible on a forearm, glaring on the flat
  five-fingered thing at the end of it — and on a head, where it decides which
  way someone is looking. The pelvis and chest are rolled until their hip and
  shoulder lines match, the head gets an explicit look direction, and hands get
  their palms rolled and their fingers curled. Left alone the batter watches the
  pitch from whatever angle the maths landed on, holding his bat with two
  splayed jazz hands.
- **Hand height decides whether an elbow can hang.** The elbow rides a circle
  perpendicular to the shoulder-to-hand line. Hold the hands high and close and
  that line points steeply up, "down" is nearly parallel to it, and the
  furthest-down point on the circle is still level with the shoulder — so the
  elbow goes *behind* instead and the arm reads as one straight limb folded back
  on itself. Dropping the hands to chin height and setting them back is what lets
  it drop.
- **Reach is what decides whether an arm can bend.** The front arm has to span
  from the front of the chest to hands held behind the rear shoulder. Let that
  distance exceed the arm's length and IK simply straightens it — and the
  straight line runs through the ribcage. The hands have to sit far enough off
  the body for the arm to have slack and to route around the chest;
  `tools/pose/check-clip.mjs` measures the clearance.
- **Two hands can't meet on a bat handle with fixed shoulders.** They're 1.4 ft
  apart and the arms are 1.98 ft each; reaching one grip point locks the front
  arm straight. A real shoulder girdle protracts, so the clavicles are posed too
  — but only an inch or two. Shoving a shoulder far enough to buy real reach
  tears it visibly off the torso; the reach has to come from where the hands are.
- **Place the second hand along the bat, not near it.** Both hands are derived
  from one grip point and the barrel axis, and that axis ships in `poses.json`
  so the renderer draws the bat down the same line. Two independent offsets that
  merely look similar leave one hand holding air.
- **A pose is world-space, so a rotated parent group won't turn a character.**
  It moves the position and leaves the orientation, and they disagree. Bake the
  facing into the pose.
- **A hand bone is the wrist, not the grip.** Props take an offset in the bone's
  own frame to reach the palm.
- **Props read their transform relative to their own parent.** Writing a bone's
  world transform straight into a group that sits under a positioned parent
  counts that parent's placement twice — which is how the mitt ended up 2.6 ft
  behind the catcher's hand.
- **Anything you `new` in a component has to be released.** `StrikeZone`
  remounts for every pitch (its parent is keyed on pitch id), so the geometries
  it builds leak a pair per pitch unless disposed — and the scoreboard's canvas
  texture is rebuilt on every count change. Three won't garbage-collect GPU
  resources for you.
- **`transparent` is fixed at material creation.** Toggling it later needs a
  shader recompile, so a fade that flips it silently does nothing.
- **Keep `depthWrite` on while ghosting.** The mannequin is double-sided with a
  dozen overlapping shells; without it a 15%-opacity ghost compounds back to
  nearly solid.

### Props

The bat is a real 33-inch model converted from FBX (`tools/fbx-to-glb.mjs`),
knob at the origin and barrel up +y — the axis `BoneAttach` aims, so it needs no
rotation of its own. Its texture is the slice of the pack's shared atlas that
this bat actually samples: cropped from the mesh's own UV bounds, downscaled and
re-encoded, 2.18 MB of atlas down to 22 KB with no loss where it shows.

Watch the v axis when converting. glTF puts UV (0,0) at the image's *top* left
while the FBX gives them bottom-up, so the flip has to happen at conversion —
get it wrong and the grip tape ends up wrapped round the barrel.

Both hands are derived from a single grip point and that same barrel axis, which
ships in `poses.json`. Two independent offsets that merely look similar leave one
hand holding air.

### The pitcher

Two things had to be reconciled with the geometry the game is built on. At the
release frame the mannequin's hand sits 6.81 ft up while `trajectory()` launches
the ball from 6.1 ft — so the pitcher is *scaled to fit the trajectory* rather
than the trajectory bent to fit him; it decides the call. And the source clip
throws on the spot (its hips travel about a foot), so the body is carried from
the rubber to the release point over the wind-up. At 60 ft that reads as a
stride; up close his feet would skate.

The ball leaves his hand exactly where `trajectory(0)` starts it.

## The stadium

`Stadium.tsx` is everything past the diamond: a gradient night sky, the outfield
wall with pad seams and painted distances, hoardings, a two-tier crowd bowl with
an LED ribbon between decks, roof pennants, batter's eye, scoreboard and light
towers. Camera flashes blink round the bowl on their own schedules — the
cheapest thing that makes a night crowd feel populated rather than painted on.

`Field.tsx` carries the warning track, a checkerboard mowing pattern, bullpen
mounds down each line, and the infield.

It's all big shapes and low segment counts — scenery a few hundred feet away seen
through a 38-degree lens — and every texture is generated at runtime, so none of
it touches disk.

The board is drawn to a canvas rather than built from meshes — a line score is
dozens of little glyphs, and one texture costs far less than the geometry would.
Its ball/strike/out lamps read the live count off the current pitch, so the
scoreboard agrees with the matchup bar.

Three things to know if you move any of it:

- **Mind the camera's far plane.** The bowl sits 460-490 ft out and the sky dome
  at 900. The far plane was 400, so the entire stadium was clipped away and only
  a sliver of the nearest seating survived — which looks exactly like a lighting
  or culling bug and is neither.
- **The bowl has to light itself.** Its inward faces point away from every key
  light, so lit conventionally only the side sections catch anything. It carries
  an emissive term instead; a stand full of people under floods reads as self-lit
  from the plate anyway.
- **Draw the infield as one skin, not as separate features.** A base path is
  only legible as a path because there's grass beside it. Drawing the 95-ft arc
  on its own left a dirt band stranded out in the outfield that read as a second
  diamond behind the first. It's one dirt surface from home to the arc, with a
  grass square cut into the middle.
- **Watch the vertical budget.** The view only reaches ~12 degrees above
  horizontal, and the bowl, ribbon, upper deck, pennants and towers all compete
  for it. A second deck at full height simply fills the sky and hides everything
  behind it.
- **Check what's actually in frame before adding scenery.** The view reaches
  about 12 degrees above horizontal and 31 to either side of centre field. The
  first set of light towers were 116 ft tall at 425 ft — above the top edge — and
  the rest were placed outside the horizontal frustum entirely. None of them were
  ever going to show.

## Sound

`src/audio/stadium.ts` synthesises the ambience rather than streaming it. The
crowd bed is shaped brown noise for the body plus a thinner high band for
chatter, both drifting under slow LFOs and pushed through a generated impulse
response. That's a few hundred bytes of code instead of a megabyte of looping
audio, and it never seams.

Three cues sit on top:

| cue | when |
| --- | --- |
| mitt pop | the ball reaches the plate — filtered crack over a low thump |
| small swell | any call |
| full swell | the umpire and the rulebook disagree |

The crowd reacts to the *argument*, not to whether you were right.

Nothing is constructed until the first pointer or key event: browsers suspend an
AudioContext built any earlier. The mute state lives in `localStorage` alongside
the streak, and a muted player never builds the graph at all.

## Design tokens

Ink `#0a1119` · dirt `#6f4429` · grass `#24512f` · zone amber `#f2b134` · ball
clay `#cf6a41` · correct green `#4f9a63`. Oswald for scoreboard headings, IBM
Plex Sans for body, IBM Plex Mono for data.

## Licensing note

Statcast **data** (locations, velocities, calls) is freely queryable through
pybaseball / Baseball Savant for a project like this. Broadcast **video** is
not — don't embed real clips. Reconstructing the pitch in 3D from the data is
the point, and it sidesteps the problem entirely.
