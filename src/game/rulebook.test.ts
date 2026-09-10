import test from "node:test";
import assert from "node:assert/strict";
import { BALL_R, PLATE_HALF, edgeMargin, rulebookCall } from "./rulebook.js";

const zone = { szBot: 1.5, szTop: 3.5 };

test("rulebookCall counts a ball touching the horizontal edge as a strike", () => {
  assert.equal(rulebookCall({ ...zone, px: PLATE_HALF + BALL_R, pz: 2.5 }), "strike");
});

test("rulebookCall counts a miss beyond the padded zone as a ball", () => {
  assert.equal(rulebookCall({ ...zone, px: PLATE_HALF + BALL_R + 0.001, pz: 2.5 }), "ball");
});

test("edgeMargin is positive inside and negative outside", () => {
  assert.equal(edgeMargin({ ...zone, px: PLATE_HALF, pz: 2.5 }) > 0, true);
  assert.equal(edgeMargin({ ...zone, px: 0, pz: zone.szBot - BALL_R - 0.25 }) < 0, true);
});
