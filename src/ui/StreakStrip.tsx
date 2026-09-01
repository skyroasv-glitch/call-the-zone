import type { SaveState } from "../game/storage";
import { todayKey, shiftDate } from "../game/daily";

/**
 * The last two weeks of dailies, one cell per day.
 *
 * This is the archive we do have: it shows how you did without letting you play
 * a day back, which is what keeps a streak meaning "showed up every day" rather
 * than "got round to it eventually". Gaps stay visible on purpose.
 */

const DAYS = 14;

const LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric",
});

/** Clay through to green, so a row of good days reads as a green run. */
function shade(score: number, total: number): string {
  const t = total > 0 ? score / total : 0;
  const from = [207, 106, 65];   // --clay
  const to = [79, 154, 99];      // --green
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

export function StreakStrip({ save }: { save: SaveState }) {
  // Nothing to look back on yet — an empty fortnight is just noise on a first
  // visit, and the stats row already says the streak is zero.
  if (!save.played) return null;

  const today = todayKey();
  const days = Array.from({ length: DAYS }, (_, i) => shiftDate(today, -(DAYS - 1 - i)));

  return (
    <section className="strip" aria-label={`Last ${DAYS} days`}>
      <div className="strip-head">
        <h2>Last {DAYS} days</h2>
        <span>{save.played} played · best {save.maxStreak}</span>
      </div>
      <ol className="strip-row">
        {days.map((date) => {
          const day = save.history[date];
          const isToday = date === today;
          const when = LABEL.format(new Date(`${date}T12:00:00`));
          return (
            <li
              key={date}
              className={`strip-day${day ? " done" : ""}${isToday ? " today" : ""}`}
              style={day ? { background: shade(day.score, day.results.length) } : undefined}
              title={day
                ? `${when} — ${day.score}/${day.results.length}`
                : `${when} — not played`}
            >
              <span className="strip-score">{day ? day.score : ""}</span>
              <span className="sr-only">
                {day ? `${when}, ${day.score} of ${day.results.length}` : `${when}, not played`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
