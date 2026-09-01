# Data pipeline

Turns a day of real Statcast pitches into a five-pitch puzzle file for the game.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Regenerating puzzles

Run from this directory. Output lands in `../public/puzzles/<date>.json`, which
the app fetches by the player's local date.

```bash
.venv/bin/python build_puzzle.py
```

Statcast lags about a day, so with no arguments the script pulls the game day
from two days ago and publishes it under today's date. To control both ends:

```bash
.venv/bin/python build_puzzle.py --date 2025-08-19 --publish-as 2025-08-21
```

| flag | meaning |
| --- | --- |
| `--date` | game day to pull pitches from (default: 2 days ago) |
| `--publish-as` | date the puzzle is served under (default: today) |
| `-n` | pitches per puzzle (default 5) |
| `--out` | output directory (default `../public/puzzles`) |

The first pull of a given day hits Baseball Savant and takes a few seconds;
pybaseball caches afterward.

To fill a runway ahead of today (`seq 0` so today itself is covered):

```bash
for i in $(seq 0 29); do
  .venv/bin/python build_puzzle.py \
    --date "$(date -v-${i}d -v-1y +%F)" \
    --publish-as "$(date -v+${i}d +%F)"
done
```

In practice this is automated: `.github/workflows/puzzles.yml` runs `topup.py`
daily and commits whatever was missing. Reach for the loop below only for a
manual backfill or a first fill.

```bash
python topup.py --dry-run     # what is missing
python topup.py --days 45     # fill it
```

`topup.py` only writes dates that have no file, so running it repeatedly is
safe, and it maps each publish date to a source game day deterministically —
same calendar day last season, or a stable in-season pick when that lands in
the off-season, so a December puzzle still has real pitches.

Keep at least two days of runway at all times. The client keys off the player's
**local** date, so a given puzzle goes live in UTC+14 about 26 hours before it
does in UTC−11 — generating "today" on the day means the earliest timezones
spend hours on the fallback set.

## What it selects

1. Keep only **taken** pitches — `called_strike` and `ball`. Swings have no
   umpire call to argue with.
2. Compute the rulebook call from geometry, using constants identical to
   `src/game/rulebook.ts`.
3. Keep pitches whose distance to the nearest zone edge falls between
   `MIN_MARGIN` (0.05 ft ≈ half an inch) and `MAX_MARGIN` (0.35 ft).

   The floor is the important one. A pitch a tenth of an inch off the line looks
   identical to one a tenth of an inch on it, and calling the player wrong on it
   reads as a bug rather than a close call. The drama belongs in
   umpire-vs-rulebook *disagreements*, not in imperceptible geometry.
4. Aim for roughly two ump-vs-rulebook disagreements per puzzle, fill the rest
   with clear-but-close calls, then shuffle so the disagreements aren't
   front-loaded.

Selection is seeded off an MD5 of the source date, so the same day always yields
the same five pitches.

Each pitch also gets a generated `note` describing the miss in inches from the
nearest edge, and `mv` movement presets by pitch type — these are
**animation-only** shaping values, not measured break, and they never affect
where the ball lands.

## Schema

Matches `Pitch` in `src/game/types.ts`. Everything is in feet, per Statcast.

```json
{
  "date": "2025-08-21",
  "sourceGameDate": "2025-08-19",
  "pitches": [{
    "id": "2025-08-19-4365",
    "pitcher": "L. Mey",
    "pitchType": "Slider",
    "velo": 85.9,
    "px": -0.528, "pz": 2.966,
    "szTop": 3.555, "szBot": 1.697,
    "hand": "R", "stand": "R",
    "umpCall": "strike",
    "situation": "2-0, 0 outs",
    "note": "Caught the inside corner by 3.6 in. Both had it a strike.",
    "mv": { "sag": 0.7, "curve": -1.4 }
  }]
}
```

Notes are written from the **rounded** coordinates, not the raw Statcast floats.
The client recomputes the margin from the three-decimal values in the JSON, so a
note built from full precision can claim "2.0 in" where the player is shown 1.9.
The self-check after writing catches exactly that and refuses to publish; keep
`describe()` fed from the same numbers that ship.

If you change the plate or ball constants here, change them in
`src/game/rulebook.ts` too — the game scores the player against the client-side
copy, and a mismatch would show a pitch judged one way and drawn another.

## Serving

Static JSON in `public/` is the whole deployment. If you'd rather serve puzzles
dynamically later, a FastAPI endpoint returning this same shape at
`/puzzles/<date>.json` is a drop-in replacement — the client only needs the
response to carry a JSON content type.
