import type { Judged } from "../game/store";

export function StreakDots({ judged, index, total }: {
  judged: Judged[]; index: number; total: number;
}) {
  return (
    <div className="streak-dots" aria-label="progress">
      {Array.from({ length: total }, (_, i) => {
        const j = judged[i];
        const cls = j ? (j.correct ? "hit" : "miss") : i === index ? "now" : "";
        return <span key={i} className={`dot ${cls}`} />;
      })}
    </div>
  );
}
