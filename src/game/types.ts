export type Call = "ball" | "strike";

export interface Pitch {
  id: string;
  pitcher: string;
  pitchType: string;      // "Slider", "Fastball", ...
  velo: number;           // mph
  px: number;             // plate_x, feet
  pz: number;             // plate_z, feet
  szTop: number;          // sz_top, feet
  szBot: number;          // sz_bot, feet
  hand: "R" | "L";        // pitcher throwing hand
  stand: "R" | "L";       // batter side (Statcast `stand`)
  umpCall: Call;          // what the human ump actually called
  situation: string;      // "3-2, 2 out"
  note: string;           // one-liner shown on reveal
  mv: { sag: number; curve: number }; // animation-only: vertical sag & horizontal break, feet
}

export interface Puzzle {
  date: string;           // YYYY-MM-DD
  pitches: Pitch[];
}

function isCall(value: unknown): value is Call {
  return value === "ball" || value === "strike";
}

function isHand(value: unknown): value is "R" | "L" {
  return value === "R" || value === "L";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPitch(value: unknown): value is Pitch {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  const mv = p.mv as Record<string, unknown> | undefined;
  return typeof p.id === "string"
    && typeof p.pitcher === "string"
    && typeof p.pitchType === "string"
    && isFiniteNumber(p.velo)
    && isFiniteNumber(p.px)
    && isFiniteNumber(p.pz)
    && isFiniteNumber(p.szTop)
    && isFiniteNumber(p.szBot)
    && isHand(p.hand)
    && isHand(p.stand)
    && isCall(p.umpCall)
    && typeof p.situation === "string"
    && typeof p.note === "string"
    && typeof mv === "object"
    && mv !== null
    && isFiniteNumber(mv.sag)
    && isFiniteNumber(mv.curve);
}

export function isPuzzle(value: unknown): value is Puzzle {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return typeof p.date === "string"
    && Array.isArray(p.pitches)
    && p.pitches.every(isPitch);
}
