import type { Pitch } from "../game/types";

/** `total` of 0 means an open-ended run — the count has no denominator then. */
export function Matchup({ pitch, index, total, fallback }: {
  pitch: Pitch; index: number; total: number; fallback?: boolean;
}) {
  return (
    <div className="matchup">
      <span className="matchup-count">
        Pitch {index + 1}{total > 0 && ` / ${total}`}
      </span>
      {fallback && <span className="practice-badge">Practice set</span>}
      <span className="matchup-name">{pitch.pitcher}</span>
      <div className="matchup-data">
        <span><b>{pitch.pitchType}</b></span>
        <span><b>{pitch.velo.toFixed(1)}</b> mph</span>
        <span>{pitch.hand}HP</span>
        <span>{pitch.situation}</span>
      </div>
    </div>
  );
}
