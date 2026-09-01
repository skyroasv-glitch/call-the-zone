"""Build a daily "Call the Zone" puzzle from Statcast pitch data.

Pulls one day of pitches with pybaseball, keeps only taken pitches (called
strikes and balls), computes the rulebook/ABS call from geometry, and writes a
deterministic five-pitch puzzle to public/puzzles/<date>.json.

    python build_puzzle.py                      # yesterday-ish, written under today's date
    python build_puzzle.py --date 2025-07-04
    python build_puzzle.py --date 2025-07-04 --publish-as 2025-09-01 --n 5

Statcast data (locations, velocities, calls) is freely queryable for a project
like this. Broadcast video is not — the 3D reconstruction is the whole point.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from pybaseball import statcast

# Must stay identical to src/game/rulebook.ts — this is the same ground truth.
PLATE_HALF = 0.708  # half of the 17-inch plate, feet
BALL_R = 0.121      # baseball radius, feet

# Curation rule: a pitch has to be off the boundary by a readable margin.
# Sub-half-inch pitches look identical to the eye and feel like a bug.
MIN_MARGIN = 0.05
MAX_MARGIN = 0.35   # beyond this it stops being borderline and stops being fun

# Animation-only movement presets, feet. Negative sag = ride/rise.
MV = {
    "4-Seam Fastball": {"sag": -0.35, "curve": 0.3},
    "Slider":          {"sag": 0.7,  "curve": -1.4},
    "Sweeper":         {"sag": 0.6,  "curve": 2.1},
    "Slurve":          {"sag": 1.4,  "curve": 1.6},
    "Curveball":       {"sag": 2.4,  "curve": 0.5},
    "Knuckle Curve":   {"sag": 2.4,  "curve": 0.5},
    "Changeup":        {"sag": 1.2,  "curve": 0.7},
    "Split-Finger":    {"sag": 1.6,  "curve": 0.4},
    "Sinker":          {"sag": 1.0,  "curve": -0.9},
    "Cutter":          {"sag": 0.4,  "curve": -0.7},
}
DEFAULT_MV = {"sag": 0.6, "curve": 0.0}

REQUIRED = [
    "plate_x", "plate_z", "sz_top", "sz_bot", "description",
    "pitch_name", "release_speed", "p_throws", "stand", "balls", "strikes",
]


def signed_margins(px: float, pz: float, sz_top: float, sz_bot: float):
    """Distance to each zone edge. Positive means inside that edge."""
    return (
        (PLATE_HALF + BALL_R) - abs(px),   # side
        (sz_top + BALL_R) - pz,            # top
        pz - (sz_bot - BALL_R),            # bottom
    )


def rulebook_call(px: float, pz: float, sz_top: float, sz_bot: float) -> str:
    """Any part of the ball over any part of the zone is a strike."""
    return "strike" if min(signed_margins(px, pz, sz_top, sz_bot)) >= 0 else "ball"


def edge_margin(px: float, pz: float, sz_top: float, sz_bot: float) -> float:
    """
    How far the pitch sits from the ball/strike boundary, in feet.

    Take the *signed* minimum, not the smallest absolute distance. A pitch can
    sit comfortably inside the plate horizontally while missing low — the edge
    that decides the call is the one it is furthest outside, and for a strike
    it's the nearest edge it caught. Using absolute distances picks the wrong
    edge and reports a pitch that missed low as having missed a corner.
    """
    return abs(min(signed_margins(px, pz, sz_top, sz_bot)))


def tidy_name(raw: str) -> str:
    """Statcast gives 'Last, First'. Render it as 'F. Last'."""
    if not isinstance(raw, str) or "," not in raw:
        return raw if isinstance(raw, str) else "Pitcher"
    last, first = (part.strip() for part in raw.split(",", 1))
    return f"{first[:1]}. {last}" if first else last


def describe(row: pd.Series) -> str:
    """One-liner for the reveal panel, built from where the pitch actually was."""
    px, pz = float(row.plate_x), float(row.plate_z)
    ump = row.ump
    stand = getattr(row, "stand", "R")

    d_side, d_top, d_bot = signed_margins(px, pz, row.sz_top, row.sz_bot)

    # A right-handed batter stands on the -x side, so a negative plate_x is
    # inside to him and outside to a lefty.
    near_hand = "inside" if (px < 0) == (stand == "R") else "outside"
    margin, edge = min(
        [(d_side, f"the {near_hand} corner"),
         (d_top, "the top of the zone"),
         (d_bot, "the bottom of the zone")],
        key=lambda pair: pair[0],
    )
    truth = "strike" if margin >= 0 else "ball"
    verb = "Caught" if margin >= 0 else "Missed"
    where = f"{verb} {edge} by {abs(margin) * 12:.1f} in"

    if truth != ump:
        return f"{where} — the umpire called it a {ump}."
    return f"{where}. Both had it a {truth}."


def build_daily_puzzle(target_day: str, n: int = 5, publish_as: str | None = None) -> dict:
    df = statcast(start_dt=target_day, end_dt=target_day)
    if df is None or df.empty:
        raise SystemExit(f"No Statcast rows for {target_day} (off-day, or data not posted yet).")

    df = df.dropna(subset=REQUIRED)
    called = df[df.description.isin(["called_strike", "ball"])].copy()
    if called.empty:
        raise SystemExit(f"No taken pitches for {target_day}.")

    called["rulebook"] = [
        rulebook_call(r.plate_x, r.plate_z, r.sz_top, r.sz_bot)
        for r in called.itertuples()
    ]
    called["ump"] = called.description.map({"called_strike": "strike", "ball": "ball"})
    called["margin"] = [
        edge_margin(r.plate_x, r.plate_z, r.sz_top, r.sz_bot)
        for r in called.itertuples()
    ]

    # Only pitches that are clearly on one side, but still near the line.
    readable = called[called.margin.between(MIN_MARGIN, MAX_MARGIN)]
    disagree = readable[readable.rulebook != readable.ump]
    agree = readable[readable.rulebook == readable.ump]

    seed = int(hashlib.md5(target_day.encode()).hexdigest(), 16) % (2**32)

    # Aim for roughly two ump-vs-rulebook disagreements per puzzle — that's the
    # fun — and fill the rest with clear-but-close calls.
    want_disagree = min(len(disagree), max(1, n // 2))
    picks = [disagree.sample(want_disagree, random_state=seed)] if want_disagree else []
    fill = n - want_disagree
    if fill > 0 and not agree.empty:
        picks.append(agree.sample(min(fill, len(agree)), random_state=seed))

    pool = pd.concat(picks) if picks else readable.head(n)
    if len(pool) < n:
        extra = readable.drop(pool.index, errors="ignore")
        if not extra.empty:
            pool = pd.concat([pool, extra.sample(min(n - len(pool), len(extra)), random_state=seed)])
    pool = pool.sample(frac=1, random_state=seed).head(n)  # shuffle so disagreements aren't front-loaded

    pitches = []
    for r in pool.itertuples():
        outs = int(getattr(r, "outs_when_up", 0) or 0)
        # Round first, then describe. The client recomputes the margin from the
        # coordinates we ship, so a note written from full-precision Statcast
        # values can disagree with it by a tenth of an inch at the rounding
        # boundary — which is exactly what the self-check below refuses.
        px, pz = round(float(r.plate_x), 3), round(float(r.plate_z), 3)
        sz_top, sz_bot = round(float(r.sz_top), 3), round(float(r.sz_bot), 3)
        shipped = pd.Series({
            **r._asdict(),
            "plate_x": px, "plate_z": pz, "sz_top": sz_top, "sz_bot": sz_bot,
        })
        pitches.append({
            "id": f"{target_day}-{r.Index}",
            "pitcher": tidy_name(getattr(r, "player_name", "Pitcher")),
            "pitchType": r.pitch_name,
            "velo": round(float(r.release_speed), 1),
            "px": px,
            "pz": pz,
            "szTop": sz_top,
            "szBot": sz_bot,
            "hand": r.p_throws,
            "stand": r.stand,
            "umpCall": r.ump,
            "situation": f"{int(r.balls)}-{int(r.strikes)}, {outs} out{'s' if outs != 1 else ''}",
            "note": describe(shipped),
            "mv": MV.get(r.pitch_name, DEFAULT_MV),
        })

    return {"date": publish_as or target_day, "sourceGameDate": target_day, "pitches": pitches}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", help="game day to pull (YYYY-MM-DD); default: 2 days ago")
    ap.add_argument("--publish-as", help="date the puzzle is served under; default: today")
    ap.add_argument("-n", type=int, default=5, help="pitches per puzzle (default 5)")
    ap.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "public" / "puzzles"),
        help="output directory (default: ../public/puzzles)",
    )
    args = ap.parse_args()

    # Statcast lags roughly a day, so default to a day that is definitely posted.
    game_day = args.date or (date.today() - timedelta(days=2)).isoformat()
    publish = args.publish_as or date.today().isoformat()

    puzzle = build_daily_puzzle(game_day, n=args.n, publish_as=publish)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{publish}.json"
    out_path.write_text(json.dumps(puzzle, indent=2))

    # The client scores against its own copy of the geometry, so make sure the
    # note we ship agrees with the margin it will compute.
    for p in puzzle["pitches"]:
        inches = edge_margin(p["px"], p["pz"], p["szTop"], p["szBot"]) * 12
        assert f"{inches:.1f} in" in p["note"], f"note disagrees with geometry: {p['note']}"

    n_dis = sum(1 for p in puzzle["pitches"]
                if rulebook_call(p["px"], p["pz"], p["szTop"], p["szBot"]) != p["umpCall"])
    print(f"wrote {out_path} — {len(puzzle['pitches'])} pitches from {game_day}, "
          f"{n_dis} ump disagreement(s)")


if __name__ == "__main__":
    main()
