#!/usr/bin/env python3
"""
Keeps a rolling runway of daily puzzles on disk.

Run it on a schedule. It looks at the next `--days` dates, generates a puzzle
for any that are missing, and leaves the ones that already exist alone — so it
is safe to run every day, and a run that fails changes nothing.

Two things this handles that the README's shell loop does not:

*Ahead, not "today".* The client keys off the player's LOCAL date, so a given
puzzle goes live in UTC+14 about 26 hours before it does in UTC-11. Generating
"today" on the day means the earliest timezones spend hours on the fallback set.
Keeping a buffer removes the race entirely, and means a failed run or a Baseball
Savant outage costs nothing as long as it is fixed within the runway.

*The off-season.* Source days are drawn from the same calendar day a year
earlier, which works from April to September and returns nothing in January.
When the natural source falls outside the season, a day is picked from the
previous season's window instead, deterministically from the publish date — so
the same date always yields the same puzzle no matter when the job runs.

    python data-pipeline/topup.py                 # top up the next 30 days
    python data-pipeline/topup.py --days 45
    python data-pipeline/topup.py --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build_puzzle.py"
OUT_DIR = HERE.parent / "public" / "puzzles"

# Conservative in-season window: every day inside it has a full slate, which is
# what the selector needs to find borderline taken pitches.
SEASON_START = (4, 10)
SEASON_END = (9, 25)

# A source day can still fail — an off-day, a rainout, or too few pitches near
# the zone edge. Walk back rather than give up on the date.
MAX_ATTEMPTS = 10


def in_season(d: date) -> bool:
    return (d.month, d.day) >= SEASON_START and (d.month, d.day) <= SEASON_END


def season_span(year: int) -> tuple[date, int]:
    start = date(year, *SEASON_START)
    end = date(year, *SEASON_END)
    return start, (end - start).days


def source_for(publish: date) -> date:
    """
    The game day a published date draws from.

    Same calendar day last season when that lands in the season, so a puzzle
    published in July comes from July. Otherwise a stable pick from the previous
    season, hashed off the publish date so it never moves.
    """
    natural = publish.replace(year=publish.year - 1) if (publish.month, publish.day) != (2, 29) \
        else date(publish.year - 1, 2, 28)
    if in_season(natural):
        return natural

    start, span = season_span(publish.year - 1)
    digest = hashlib.md5(publish.isoformat().encode()).hexdigest()
    return start + timedelta(days=int(digest, 16) % (span + 1))


def build(source: date, publish: date, out_dir: Path) -> bool:
    """One invocation of the generator. False if that source day yielded nothing."""
    result = subprocess.run(
        [sys.executable, str(BUILD),
         "--date", source.isoformat(),
         "--publish-as", publish.isoformat(),
         "--out", str(out_dir)],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        return True
    tail = (result.stderr or result.stdout).strip().splitlines()
    print(f"      {source} -> {tail[-1] if tail else 'failed'}")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=30,
                    help="how far ahead to keep filled (default 30)")
    ap.add_argument("--out", default=str(OUT_DIR), help="output directory")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what is missing without generating it")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    today = date.today()

    wanted = [today + timedelta(days=i) for i in range(args.days + 1)]
    missing = [d for d in wanted if not (out_dir / f"{d.isoformat()}.json").exists()]

    print(f"runway {wanted[0]} .. {wanted[-1]}  ({len(wanted)} days)")
    print(f"present {len(wanted) - len(missing)}, missing {len(missing)}")

    if not missing:
        print("nothing to do")
        return 0
    if args.dry_run:
        for d in missing:
            print(f"  would build {d}  from {source_for(d)}")
        return 0

    built, failed = 0, []
    for publish in missing:
        source = source_for(publish)
        for attempt in range(MAX_ATTEMPTS):
            candidate = source - timedelta(days=attempt)
            if not in_season(candidate):
                # Walked out of the season; jump to the end of the prior one.
                start, span = season_span(candidate.year - 1)
                candidate = start + timedelta(days=span)
            if build(candidate, publish, out_dir):
                print(f"  {publish}  <- {candidate}")
                built += 1
                break
        else:
            failed.append(publish)

    print(f"\nbuilt {built}, failed {len(failed)}")
    if failed:
        print("failed:", ", ".join(d.isoformat() for d in failed))
        # A partial top-up is still progress, and the runway absorbs it. Only a
        # completely empty result is worth failing the job over.
        return 0 if built else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
