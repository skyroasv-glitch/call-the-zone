const KEY = "call-the-zone/v1";

export interface DayResult {
  date: string;
  results: boolean[];      // correct vs. rulebook, per pitch
  score: number;
}

export interface SaveState {
  muted: boolean;
  /** The short first-play explainer is shown once, then stays out of the way. */
  introSeen: boolean;
  /** Chosen uniform, worn by the pitcher and catcher. See scene/uniform.ts. */
  skinId: string;
  lastPlayed: string | null;
  streak: number;
  maxStreak: number;
  played: number;
  history: Record<string, DayResult>;
  /** Infinite mode: longest correct-call streak and lifetime pitches judged. */
  bestRun: number;
  runsPlayed: number;
  pitchesSeen: number;
}

const EMPTY: SaveState = {
  muted: false, introSeen: false, skinId: "home-whites", lastPlayed: null, streak: 0, maxStreak: 0, played: 0, history: {},
  bestRun: 0, runsPlayed: 0, pitchesSeen: 0,
};

export function loadSave(): SaveState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(raw) as SaveState) };
  } catch {
    return { ...EMPTY };
  }
}

export function writeSave(s: SaveState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — the game still plays, it just won't remember */
  }
}

function prevDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function setMutedPref(muted: boolean) {
  const s = loadSave();
  s.muted = muted;
  writeSave(s);
}

export function setSkin(skinId: string): SaveState {
  const s = loadSave();
  s.skinId = skinId;
  writeSave(s);
  return s;
}

export function setIntroSeen() {
  const s = loadSave();
  s.introSeen = true;
  writeSave(s);
  return s;
}

/** Record a finished day. Idempotent: replaying a stored day won't inflate the streak. */
export function recordDay(day: DayResult): SaveState {
  const s = loadSave();
  if (s.history[day.date]) return s;
  s.history[day.date] = day;
  s.played += 1;
  s.streak = s.lastPlayed === prevDay(day.date) ? s.streak + 1 : 1;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.lastPlayed = day.date;
  writeSave(s);
  return s;
}

/**
 * Bank an infinite run. Only the best streak is kept.
 *
 * `pitches` is how many are NEW since the last time this run was banked, and
 * `countRun` says whether this is the first bank for it — a run can be written
 * more than once (the tab is hidden mid-run, then play continues), and the
 * lifetime totals have to stay honest across that.
 */
export function recordRun(bestStreak: number, pitches: number, countRun = true): SaveState {
  const s = loadSave();
  if (pitches <= 0) return s;
  s.bestRun = Math.max(s.bestRun, bestStreak);
  if (countRun) s.runsPlayed += 1;
  s.pitchesSeen += pitches;
  writeSave(s);
  return s;
}
