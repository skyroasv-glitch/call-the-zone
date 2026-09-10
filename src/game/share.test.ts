import test from "node:test";
import assert from "node:assert/strict";
import type { Judged } from "./store";
import { shareGrid, shareText } from "./share.js";

const judged = [
  { correct: true, disagreement: false },
  { correct: false, disagreement: true },
] as Judged[];

test("shareGrid renders correct and missed calls", () => {
  assert.equal(shareGrid(judged), "\u{1F7E9}\u{1F7E5}");
});

test("shareText includes score, disagreements, streak, and origin", () => {
  globalThis.location = { origin: "https://example.test" } as Location;

  assert.equal(
    shareText("2026-09-10", judged, 3),
    [
      "Call the Zone 2026-09-10 — 1/2",
      "\u{1F7E9}\u{1F7E5}",
      "1 ump disagreement \u{1F441}\u{FE0F}",
      "\u{1F525} 3-day streak",
      "https://example.test",
    ].join("\n"),
  );
});
