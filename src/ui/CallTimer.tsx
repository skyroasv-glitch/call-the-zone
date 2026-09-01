import { useEffect, useRef } from "react";
import { CALL_SECONDS } from "../game/store";

/**
 * The infinite-mode call clock. Driven straight off the deadline in a rAF loop
 * rather than React state — a countdown that re-rendered the whole app sixty
 * times a second would fight the scene for frames.
 *
 * A backgrounded tab pauses rAF, so a player who tabs away comes back to an
 * expired call. That's the honest outcome: they weren't watching the pitch.
 */
export function CallTimer({ deadline, onExpire }: {
  deadline: number; onExpire: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // `onExpire` is a zustand action, so its identity is stable and listing it
  // here won't restart the count mid-pitch.
  useEffect(() => {
    let frame = 0;
    const total = CALL_SECONDS * 1000;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const frac = left / total;
      if (bar.current) bar.current.style.transform = `scaleX(${frac})`;
      wrap.current?.classList.toggle("urgent", left <= 1500);
      if (left <= 0) { onExpire(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [deadline, onExpire]);

  return (
    <div className="call-timer" ref={wrap} aria-hidden="true">
      <div className="call-timer-bar" ref={bar} />
    </div>
  );
}
