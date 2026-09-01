import { useState } from "react";
import type { Judged, Mode } from "../game/store";
import { bestStreak } from "../game/store";
import type { SaveState } from "../game/storage";
import { shareGrid, shareText, copyShare } from "../game/share";

/** A run can go on forever; only the tail of it fits on screen. */
const GRID_TAIL = 20;

export function Summary({ date, mode, judged, save, onReplayDay, onHome }: {
  date: string;
  mode: Mode;
  judged: Judged[];
  save: SaveState;
  onReplayDay: () => void;
  onHome: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const score = judged.filter((j) => j.correct).length;
  const robbed = judged.filter((j) => j.disagreement).length;
  const infinite = mode === "infinite";
  const tail = infinite ? judged.slice(-GRID_TAIL) : judged;

  const share = async () => {
    const text = shareText(date, judged, save.streak);
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch { /* fall through to copy */ }
    }
    setCopied(await copyShare(text));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="summary">
      <div className="final">{score}<small>/{judged.length}</small></div>
      <div className="grid-row">{shareGrid(tail)}</div>
      <div className="summary-stats">
        {infinite ? (
          <>
            <div><b>{bestStreak(judged)}</b>run streak</div>
            <div><b>{save.bestRun}</b>all-time best</div>
            <div><b>{judged.length ? Math.round((score / judged.length) * 100) : 0}%</b>accuracy</div>
            <div><b>{robbed}</b>ump disputes</div>
          </>
        ) : (
          <>
            <div><b>{save.streak}</b>day streak</div>
            <div><b>{save.maxStreak}</b>best</div>
            <div><b>{robbed}</b>ump disputes</div>
          </>
        )}
      </div>
      <div className="summary-actions">
        <button className="ghost-btn" onClick={onHome}>Home</button>
        <button className="ghost-btn" onClick={onReplayDay}>
          {infinite ? "New run" : "Watch again"}
        </button>
        {!infinite && (
          <button className="primary-btn" style={{ width: "auto", padding: "16px 28px" }} onClick={share}>
            {copied ? "Copied" : "Share"}
          </button>
        )}
      </div>
    </div>
  );
}
