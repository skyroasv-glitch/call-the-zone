export const PLATE_HALF = 0.708; // half of 17-inch plate, feet
export const BALL_R = 0.121;     // baseball radius, feet

export function rulebookCall(p: {
  px: number; pz: number; szTop: number; szBot: number;
}): "ball" | "strike" {
  const inX = Math.abs(p.px) <= PLATE_HALF + BALL_R;
  const inY = p.pz >= p.szBot - BALL_R && p.pz <= p.szTop + BALL_R;
  return inX && inY ? "strike" : "ball";
}

/** Signed distance in feet from the nearest zone edge. Positive = inside. */
export function edgeMargin(p: {
  px: number; pz: number; szTop: number; szBot: number;
}): number {
  const dx = PLATE_HALF + BALL_R - Math.abs(p.px);
  const dTop = p.szTop + BALL_R - p.pz;
  const dBot = p.pz - (p.szBot - BALL_R);
  return Math.min(dx, dTop, dBot);
}
