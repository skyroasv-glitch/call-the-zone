import test from "node:test";
import assert from "node:assert/strict";
import { hashDate, shiftDate, todayKey } from "./daily.js";

test("todayKey formats a local date key", () => {
  assert.equal(todayKey(new Date(2026, 8, 10, 23, 30)), "2026-09-10");
});

test("shiftDate moves across month boundaries in local time", () => {
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});

test("hashDate is deterministic and unsigned", () => {
  assert.equal(hashDate("2026-09-10"), hashDate("2026-09-10"));
  assert.equal(hashDate("2026-09-10") >= 0, true);
});
