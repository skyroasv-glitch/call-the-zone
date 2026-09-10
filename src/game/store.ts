import { create } from "zustand";
import type { Call, Pitch, Puzzle } from "./types";
import { isPuzzle } from "./types";
import { rulebookCall } from "./rulebook";
import { todayKey, hashDate, shiftDate } from "./daily";
import { loadSave, recordDay, recordRun, setIntroSeen, setMutedPref, setSkin, type SaveState } from "./storage";
import { mittPop, crowdSwell, setMuted } from "../audio/stadium";

export type Phase =
  | "home"      // mode picker
  | "loading"   // fetching the puzzle
  | "ready"     // matchup shown, waiting for the wind-up
  | "pitching"  // ball in flight
  | "awaiting"  // ball frozen at the plate, call it
  | "revealed"  // verdict panel up
  | "summary";  // the day (or the run) is over

/** Daily = five curated pitches. Infinite = an endless shuffled bag of them. */
export type Mode = "daily" | "infinite";

export interface Judged {
  pitch: Pitch;
  /** "none" when the infinite-mode clock ran out before a call was made. */
  guess: Call | "none";
  rulebook: Call;
  correct: boolean;
  disagreement: boolean; // ump and rulebook differ — the fun one
}

interface GameState {
  phase: Phase;
  mode: Mode;
  puzzle: Puzzle | null;
  /** True when a dated puzzle was unavailable and we dealt a practice set. */
  isFallback: boolean;
  error: string | null;
  index: number;
  judged: Judged[];
  save: SaveState;
  replayNonce: number; // bump to re-run the flight animation
  resumeTo: Phase | null; // where a replay returns to when the ball lands
  bag: Pitch[]; // infinite mode: pitches not yet dealt this shuffle
  /** Infinite mode: epoch ms the call is due by, or null when nothing is timed. */
  deadline: number | null;
  /**
   * How many of this run's pitches are already in the lifetime totals. A run is
   * banked when you leave it, which can happen more than once, so this is what
   * keeps `pitchesSeen` from counting the same pitch twice.
   */
  bankedPitches: number;

  startDaily: () => Promise<void>;
  startInfinite: () => Promise<void>;
  goHome: () => void;
  throwPitch: () => void;
  arrive: () => void;
  call: (guess: Call) => void;
  timeUp: () => void;
  next: () => void;
  bankRun: () => void;
  endRun: () => void;
  replay: () => void;
  restart: () => void;
  toggleMuted: () => void;
  markIntroSeen: () => void;
  chooseSkin: (id: string) => void;
}

const PUZZLE_COUNT = 5;
/**
 * Seconds to call a pitch in infinite mode. The clock starts when the ball
 * reaches the plate — never at load or release, or it would be timing the
 * animation and the player's hardware instead of their judgement.
 */
export const CALL_SECONDS = 5;
/** How far back to look for generated puzzles when stocking the infinite bag. */
const POOL_DAYS = 21;
let loadSeq = 0;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    // A dev server happily answers a missing file with index.html, so the
    // content type is the only trustworthy "this puzzle exists" signal.
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getPuzzle(url: string): Promise<Puzzle | null> {
  const json = await getJson<unknown>(url);
  return isPuzzle(json) ? json : null;
}

interface LoadedPuzzle {
  puzzle: Puzzle;
  isFallback: boolean;
}

async function fetchPuzzle(date: string): Promise<LoadedPuzzle> {
  const base = import.meta.env.BASE_URL;

  const dated = await getPuzzle(`${base}puzzles/${date}.json`);
  if (dated?.pitches?.length) return { puzzle: dated, isFallback: false };

  // No puzzle generated for today — fall back to the rotating mock set so the
  // game is always playable, still deterministic for the date.
  const mock = await getPuzzle(`${base}puzzles/mock-puzzle.json`);
  if (!mock?.pitches?.length) throw new Error(`No puzzle available for ${date}`);
  const offset = hashDate(date) % mock.pitches.length;
  const pitches = Array.from(
    { length: Math.min(PUZZLE_COUNT, mock.pitches.length) },
    (_, i) => mock.pitches[(offset + i) % mock.pitches.length],
  );
  return { puzzle: { date, pitches }, isFallback: true };
}

/**
 * Every pitch we can lay hands on: the mock set plus whatever dated puzzles
 * have been generated recently. Deduped by id, because the daily files and the
 * mock set can name the same pitch.
 */
async function fetchPool(): Promise<Pitch[]> {
  const base = import.meta.env.BASE_URL;
  const today = todayKey();
  const urls = [
    `${base}puzzles/mock-puzzle.json`,
    ...Array.from({ length: POOL_DAYS }, (_, i) => `${base}puzzles/${shiftDate(today, -i)}.json`),
  ];
  const puzzles = await Promise.all(urls.map((u) => getPuzzle(u)));

  const seen = new Set<string>();
  const pool: Pitch[] = [];
  for (const p of puzzles) {
    for (const pitch of p?.pitches ?? []) {
      if (seen.has(pitch.id)) continue;
      seen.add(pitch.id);
      pool.push(pitch);
    }
  }
  if (!pool.length) throw new Error("No pitches available");
  return pool;
}

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draw the next infinite pitch from the bag, reshuffling the whole pool when it
 * runs dry. `avoid` keeps a fresh shuffle from repeating the pitch you just saw.
 */
function draw(bag: Pitch[], pool: Pitch[], avoid?: string): [Pitch, Pitch[]] {
  let rest = bag;
  if (!rest.length) {
    rest = shuffle(pool);
    if (rest.length > 1 && rest[0].id === avoid) [rest[0], rest[1]] = [rest[1], rest[0]];
  }
  return [rest[0], rest.slice(1)];
}

export const useGame = create<GameState>((set, get) => ({
  phase: "home",
  mode: "daily",
  puzzle: null,
  isFallback: false,
  error: null,
  index: 0,
  judged: [],
  save: loadSave(),
  replayNonce: 0,
  resumeTo: null,
  bag: [],
  deadline: null,
  bankedPitches: 0,

  startDaily: async () => {
    const seq = ++loadSeq;
    const date = todayKey();
    set({ phase: "loading", mode: "daily", error: null, puzzle: null, isFallback: false, judged: [], index: 0 });
    try {
      const { puzzle, isFallback } = await fetchPuzzle(date);
      if (seq !== loadSeq) return;
      if (!puzzle.pitches.length) throw new Error("Puzzle has no pitches");
      set({ puzzle, isFallback, phase: "ready", index: 0, judged: [], error: null, resumeTo: null, bag: [], deadline: null });
    } catch (e) {
      if (seq !== loadSeq) return;
      set({ error: e instanceof Error ? e.message : String(e), phase: "loading" });
    }
  },

  startInfinite: async () => {
    const seq = ++loadSeq;
    set({ phase: "loading", mode: "infinite", error: null, puzzle: null, isFallback: false, judged: [], index: 0 });
    try {
      const pool = await fetchPool();
      if (seq !== loadSeq) return;
      const [first, bag] = draw([], pool);
      set({
        puzzle: { date: "infinite", pitches: [first] },
        isFallback: false,
        bag,
        phase: "ready",
        index: 0,
        judged: [],
        error: null,
        resumeTo: null,
        deadline: null,
        bankedPitches: 0,
      });
    } catch (e) {
      if (seq !== loadSeq) return;
      set({ error: e instanceof Error ? e.message : String(e), phase: "loading" });
    }
  },

  goHome: () => {
    loadSeq++;
    // Leaving mid-run used to discard it outright — the streak and the pitches
    // both vanished unless you had pressed End run first.
    get().bankRun();
    set({
      phase: "home", puzzle: null, judged: [], index: 0, bankedPitches: 0,
      error: null, isFallback: false, resumeTo: null, bag: [], deadline: null, save: loadSave(),
    });
  },

  throwPitch: () => {
    if (get().phase !== "ready") return;
    set({ phase: "pitching" });
  },

  arrive: () => {
    const { phase, resumeTo, mode } = get();
    if (phase !== "pitching") return;
    mittPop();
    const next = resumeTo ?? "awaiting";
    // Only a live call is on the clock: a replay lands back in "revealed",
    // where the call has already been made.
    const timed = mode === "infinite" && next === "awaiting";
    set({
      phase: next,
      resumeTo: null,
      deadline: timed ? Date.now() + CALL_SECONDS * 1000 : null,
    });
  },

  call: (guess) => {
    const { phase, puzzle, index, judged } = get();
    if (phase !== "awaiting" || !puzzle) return;
    const pitch = puzzle.pitches[index];
    const truth = rulebookCall(pitch);
    const entry: Judged = {
      pitch,
      guess,
      rulebook: truth,
      correct: guess === truth,
      disagreement: truth !== pitch.umpCall,
    };
    // The crowd cares about the argument, not whether you were right.
    crowdSwell(entry.disagreement ? 1 : 0.28);
    set({ judged: [...judged, entry], phase: "revealed", deadline: null });
  },

  /** The infinite clock expired: score it as a miss and move on. */
  timeUp: () => {
    const { phase, puzzle, index, judged, mode, deadline } = get();
    if (phase !== "awaiting" || !puzzle || mode !== "infinite" || deadline === null) return;
    const pitch = puzzle.pitches[index];
    const truth = rulebookCall(pitch);
    crowdSwell(0.2);
    set({
      judged: [...judged, {
        pitch,
        guess: "none",
        rulebook: truth,
        correct: false,
        disagreement: truth !== pitch.umpCall,
      }],
      phase: "revealed",
      deadline: null,
    });
  },

  next: () => {
    const { puzzle, index, judged, phase, mode, bag } = get();
    if (phase !== "revealed" || !puzzle) return;

    if (mode === "infinite") {
      // The bag holds the rest of this shuffle; the dealt pitches stay in
      // `puzzle.pitches` so the run recap can plot every one of them.
      const [pitch, rest] = draw(bag, puzzle.pitches.concat(bag), puzzle.pitches[index].id);
      set({
        puzzle: { ...puzzle, pitches: [...puzzle.pitches, pitch] },
        bag: rest,
        index: index + 1,
        phase: "ready",
        resumeTo: null,
        deadline: null,
      });
      return;
    }

    if (index + 1 >= puzzle.pitches.length) {
      const save = recordDay({
        date: puzzle.date,
        results: judged.map((j) => j.correct),
        score: judged.filter((j) => j.correct).length,
      });
      set({ phase: "summary", save });
      return;
    }
    set({ index: index + 1, phase: "ready", resumeTo: null, deadline: null });
  },

  /**
   * Write the run so far into the lifetime totals. Called when you leave a run
   * by any route — End run, the back arrow, or the tab going away — so a run in
   * progress is never silently thrown away. Only the pitches not already banked
   * are added, and the run itself is counted once.
   */
  bankRun: () => {
    const { mode, phase, judged, bankedPitches } = get();
    if (mode !== "infinite" || phase === "home") return;
    const fresh = judged.length - bankedPitches;
    if (fresh <= 0) return;
    set({
      save: recordRun(bestStreak(judged), fresh, bankedPitches === 0),
      bankedPitches: judged.length,
    });
  },

  endRun: () => {
    const { mode, phase } = get();
    if (mode !== "infinite" || phase === "summary" || phase === "home") return;
    get().bankRun();
    set({ phase: "summary", resumeTo: null, deadline: null });
  },

  replay: () => {
    const { phase, replayNonce, mode } = get();
    if (phase !== "awaiting" && phase !== "revealed") return;
    // A replay during a timed call would be a free pause button.
    if (mode === "infinite" && phase === "awaiting") return;
    set({ replayNonce: replayNonce + 1, phase: "pitching", resumeTo: phase });
  },

  restart: () => {
    if (get().mode === "infinite") { void get().startInfinite(); return; }
    set({ index: 0, judged: [], phase: "ready", resumeTo: null, deadline: null });
  },

  toggleMuted: () => {
    const save = { ...get().save, muted: !get().save.muted };
    setMuted(save.muted);
    setMutedPref(save.muted);
    set({ save });
  },

  markIntroSeen: () => set({ save: setIntroSeen() }),

  chooseSkin: (id) => set({ save: setSkin(id) }),
}));

/** Current streak of correct calls within this puzzle. */
export function currentStreak(judged: Judged[]): number {
  let n = 0;
  for (let i = judged.length - 1; i >= 0; i--) {
    if (!judged[i].correct) break;
    n++;
  }
  return n;
}

/** Longest run of correct calls anywhere in the list. */
export function bestStreak(judged: Judged[]): number {
  let best = 0, n = 0;
  for (const j of judged) {
    n = j.correct ? n + 1 : 0;
    if (n > best) best = n;
  }
  return best;
}
