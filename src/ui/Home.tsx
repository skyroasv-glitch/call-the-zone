import type { SaveState } from "../game/storage";
import { todayKey } from "../game/daily";
import { SkinPicker } from "./SkinPicker";

const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "long", month: "long", day: "numeric",
});

export function Home({ save, onDaily, onInfinite, onWarmup, onPickSkin }: {
  save: SaveState;
  onDaily: () => void;
  onInfinite: () => void;
  onWarmup: () => void;
  onPickSkin: (id: string) => void;
}) {
  const today = todayKey();
  const played = save.history[today];

  return (
    <div className="home">
      <div className="home-layout">
        <div className="home-hero">
          <p className="home-eyebrow">The rulebook is waiting</p>
          <h1 className="home-title">Call the <span>Zone</span></h1>
          <p className="home-tag">
            Real borderline pitches, rebuilt in 3D. Make the call before the
            rulebook and umpire reveal their verdicts.
          </p>
          <div className="home-rule" aria-label="How it works">
            <span className="home-rule-number">01</span>
            <p><b>Trust your eye.</b> You score against the ABS zone, not the umpire.</p>
          </div>
        </div>

        <div className="modes">
          <button className="mode-card daily" onClick={onDaily} onPointerEnter={onWarmup} onFocus={onWarmup}>
            <div className="mode-top">
              <span className="mode-kicker">Daily</span>
              {played
                ? <span className="mode-badge done">{played.score}/{played.results.length}</span>
                : <span className="mode-badge">5 pitches</span>}
            </div>
            <h2 className="mode-name">Today's Five</h2>
            <p className="mode-desc">
              {played
                ? "You've made today's calls. Watch them again, or come back at midnight."
                : "Five curated calls, the same five for everyone. One shot a day."}
            </p>
            <div className="mode-foot">
              <span>{LONG_DATE.format(new Date())}</span>
              <span className="mode-cta">{played ? "Replay" : "Play"} →</span>
            </div>
          </button>

          <button className="mode-card infinite" onClick={onInfinite} onPointerEnter={onWarmup} onFocus={onWarmup}>
            <div className="mode-top">
              <span className="mode-kicker">Infinite</span>
              <span className="mode-badge">5s per call</span>
            </div>
            <h2 className="mode-name">Endless Zone</h2>
            <p className="mode-desc">
              Pitch after pitch, shuffled from the whole archive. Five seconds to
              call each one. Stack up the longest streak you can, then end the
              run when you've had enough.
            </p>
            <div className="mode-foot">
              <span>{save.bestRun ? `Best streak ${save.bestRun}` : "No run yet"}</span>
              <span className="mode-cta">Start →</span>
            </div>
          </button>
        </div>
      </div>

      <SkinPicker skinId={save.skinId} onPick={onPickSkin} />

      <div className="home-stats">
        <div><b>{save.streak}</b>day streak</div>
        <div><b>{save.maxStreak}</b>best</div>
        <div><b>{save.played}</b>days played</div>
        <div><b>{save.pitchesSeen}</b>endless pitches</div>
      </div>

      <nav className="home-links" aria-label="Site">
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/credits">Credits</a>
      </nav>

      <p className="home-note">
        Space throws · <kbd>B</kbd> / <kbd>S</kbd> calls it · <kbd>R</kbd> replays · scroll to zoom.
      </p>
    </div>
  );
}
