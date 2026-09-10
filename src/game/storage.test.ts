import test from "node:test";
import assert from "node:assert/strict";
import { loadSave, recordDay, recordRun } from "./storage.js";

const store = new Map<string, string>();

globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() { return store.size; },
} as Storage;

test.beforeEach(() => {
  store.clear();
});

test("loadSave normalizes malformed persisted values", () => {
  localStorage.setItem("call-the-zone/v1", JSON.stringify({
    muted: "yes",
    introSeen: true,
    skinId: 123,
    streak: -4,
    history: {
      "2026-09-10": { results: [true, false], score: 1 },
      broken: { results: ["yes"], score: "nope" },
    },
  }));

  const save = loadSave();
  assert.equal(save.muted, false);
  assert.equal(save.introSeen, true);
  assert.equal(save.skinId, "home-whites");
  assert.equal(save.streak, 0);
  assert.deepEqual(save.history["2026-09-10"], {
    date: "2026-09-10",
    results: [true, false],
    score: 1,
  });
  assert.equal(save.history.broken, undefined);
});

test("recordDay is idempotent and increments consecutive streaks", () => {
  recordDay({ date: "2026-09-10", results: [true], score: 1 });
  recordDay({ date: "2026-09-10", results: [false], score: 0 });
  const next = recordDay({ date: "2026-09-11", results: [true], score: 1 });

  assert.equal(next.played, 2);
  assert.equal(next.streak, 2);
  assert.equal(next.maxStreak, 2);
  assert.equal(next.history["2026-09-10"].score, 1);
});

test("recordRun counts one run across repeated banks", () => {
  recordRun(3, 5, true);
  const save = recordRun(6, 2, false);

  assert.equal(save.runsPlayed, 1);
  assert.equal(save.pitchesSeen, 7);
  assert.equal(save.bestRun, 6);
});
