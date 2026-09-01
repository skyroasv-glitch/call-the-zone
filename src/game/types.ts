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
