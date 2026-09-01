import type { Judged } from "./store";

export function shareGrid(judged: Judged[]): string {
  return judged.map((j) => (j.correct ? "\u{1F7E9}" : "\u{1F7E5}")).join("");
}

export function shareText(date: string, judged: Judged[], streak: number): string {
  const score = judged.filter((j) => j.correct).length;
  const rows = [
    `Call the Zone ${date} — ${score}/${judged.length}`,
    shareGrid(judged),
  ];
  const robbed = judged.filter((j) => j.disagreement).length;
  if (robbed) rows.push(`${robbed} ump disagreement${robbed > 1 ? "s" : ""} \u{1F441}\u{FE0F}`);
  if (streak > 1) rows.push(`\u{1F525} ${streak}-day streak`);
  /*
   * Read off the page rather than hard-coded: a score with no link gives nobody
   * a way to play, and baking in a domain breaks every preview deployment.
   */
  if (typeof location !== "undefined") rows.push(location.origin);
  return rows.join("\n");
}

export async function copyShare(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
