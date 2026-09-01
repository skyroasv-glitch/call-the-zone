import type { Judged } from "../game/store";
import { edgeMargin } from "../game/rulebook";

const CallCard = ({ label, value, truth, sub }: {
  label: string; value: string; truth?: boolean; sub?: string;
}) => (
  <div className={`call-card${truth ? " truth" : ""}`}>
    <div className="label">{label}</div>
    <div className={`value ${value}`}>{value === "none" ? "no call" : value}</div>
    {sub && <div className="sub">{sub}</div>}
  </div>
);

export function Reveal({ j, last, onNext, onReplay }: {
  j: Judged; last: boolean; onNext: () => void; onReplay: () => void;
}) {
  const timedOut = j.guess === "none";
  const margin = edgeMargin(j.pitch);
  const inches = `${(Math.abs(margin) * 12).toFixed(1)} in ${margin >= 0 ? "inside" : "outside"} the zone`;

  return (
    <div className="reveal">
      <div className={`verdict ${j.correct ? "right" : "wrong"}`}>
        {j.correct ? "You got it" : timedOut ? "Out of time" : "Missed it"}
      </div>

      <div className="calls">
        <CallCard label="Your call" value={timedOut ? "none" : j.guess} />
        <CallCard label="Rulebook (ABS)" value={j.rulebook} truth sub={inches} />
        <CallCard label="Umpire called" value={j.pitch.umpCall} />
      </div>

      {j.disagreement ? (
        <div className="flag">
          <b>Fans screamed about this one.</b> The rulebook zone says{" "}
          <strong>{j.rulebook}</strong>, the umpire said{" "}
          <strong>{j.pitch.umpCall}</strong>.
        </div>
      ) : (
        <div className="flag agree">
          <b>Ump and rulebook agreed.</b> Both had it a {j.rulebook}.
        </div>
      )}

      {j.pitch.note && <p className="note">{j.pitch.note}</p>}

      <div className="reveal-actions">
        <button className="ghost-btn" onClick={onReplay}>Replay</button>
        <button className="primary-btn" onClick={onNext}>
          {last ? "See results" : "Next pitch"} <span style={{ opacity: 0.6 }}>↵</span>
        </button>
      </div>
    </div>
  );
}
