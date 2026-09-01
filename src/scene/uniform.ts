import * as THREE from "three";
import atlas from "./uv-atlas.json";

/**
 * Paints a uniform onto the mannequin's UV atlas.
 *
 * The mesh is unwrapped into one island per body region by `tools/uv-unwrap.mjs`,
 * which writes `uv-atlas.json` — the rects imported here are the same ones it
 * packed into, so the two can't drift. Each island is a cylinder around its
 * bone: u runs around the limb, v runs along it. That means a stripe drawn as a
 * vertical line in the atlas comes out as a pinstripe down the body, and a mark
 * placed at the torso island's `back` fraction lands between the shoulders.
 *
 * Textures are drawn at runtime rather than shipped as images: a skin is then
 * just a handful of colours, which costs nothing to add and keeps the model
 * download at one file.
 */

type Rect = [number, number, number, number];

const RECTS = atlas as unknown as Record<string, Rect> & {
  _torsoFacing: { chest: number; back: number };
};
const FACING = RECTS._torsoFacing;

/** Texture resolution. The torso owns a quarter of this, which is the only part read closely. */
const SIZE = 1024;

/** Which regions wear which part of the kit. */
const KIT = {
  jersey: ["torso", "upperarm_l", "upperarm_r"],
  sleeve: ["lowerarm_l", "lowerarm_r"],
  skin: ["head", "hand_l", "hand_r"],
  pants: ["pelvis", "thigh_l", "thigh_r"],
  socks: ["calf_l", "calf_r"],
  shoes: ["foot_l", "foot_r"],
} as const;

export interface Skin {
  id: string;
  name: string;
  /** One-line description for the picker. */
  blurb: string;
  jersey: string;
  /** Undershirt sleeves below the elbow. */
  sleeve: string;
  pants: string;
  socks: string;
  shoes: string;
  skin: string;
  /** Piping, collar, placket and the number's outline. */
  trim: string;
  /** Cap, helmet and mask shell. Usually the club's dark colour, not the trim. */
  cap: string;
  /** Vertical pinstripes down the jersey, or null for a plain kit. */
  pinstripe?: string | null;
  /** Worn between the shoulders. */
  number?: string;
}

/*
 * Kept deliberately generic: these are colourways, not any club's marks.
 */
export const SKINS: Skin[] = [
  {
    id: "home-whites", name: "Home Whites", blurb: "Classic cream with navy piping",
    jersey: "#f2efe6", sleeve: "#1d2c44", pants: "#f2efe6", socks: "#1d2c44",
    shoes: "#14181f", skin: "#b9835c", trim: "#1d2c44", cap: "#1d2c44", number: "27",
  },
  {
    id: "pinstripes", name: "Pinstripes", blurb: "White flannel, navy stripes",
    jersey: "#f4f3ef", sleeve: "#151c2e", pants: "#f4f3ef", socks: "#151c2e",
    shoes: "#14181f", skin: "#8d5a3b", trim: "#151c2e", cap: "#151c2e", pinstripe: "#25335a", number: "9",
  },
  {
    id: "road-greys", name: "Road Greys", blurb: "Travelling kit, red trim",
    jersey: "#9aa2ab", sleeve: "#8f2b2b", pants: "#9aa2ab", socks: "#8f2b2b",
    shoes: "#1b1b1b", skin: "#6d4326", trim: "#8f2b2b", cap: "#8f2b2b", number: "44",
  },
  {
    id: "dusk", name: "Dusk", blurb: "Alternate blacks with gold",
    jersey: "#1b1f27", sleeve: "#0e1117", pants: "#232833", socks: "#0e1117",
    shoes: "#0b0d11", skin: "#c08a5e", trim: "#f2b134", cap: "#14181f", number: "3",
  },
  {
    id: "clay", name: "Clay", blurb: "Burnt orange over sand",
    jersey: "#cf6a41", sleeve: "#2b1a12", pants: "#e0d5c4", socks: "#2b1a12",
    shoes: "#241811", skin: "#7a4b2a", trim: "#2b1a12", cap: "#2b1a12", number: "11",
  },
  {
    id: "turf", name: "Turf", blurb: "Deep green, cream numerals",
    jersey: "#24512f", sleeve: "#16301d", pants: "#e6e2d3", socks: "#16301d",
    shoes: "#141a14", skin: "#a06c44", trim: "#e6e2d3", cap: "#16301d", number: "6",
  },
];

export const DEFAULT_SKIN = SKINS[0];

export function skinById(id: string | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;
}

/*
 * A CanvasTexture is sampled with (0,0) at the bottom-left, while a canvas
 * draws from the top-left — so every rect is flipped on the way in. Getting
 * this wrong is invisible on a solid colour and only shows up as an upside-down
 * number, which is exactly the kind of thing that ships.
 */
function place(rect: Rect): [number, number, number, number] {
  const [x, y, w, h] = rect;
  return [x * SIZE, (1 - y - h) * SIZE, w * SIZE, h * SIZE];
}

function fill(ctx: CanvasRenderingContext2D, regions: readonly string[], color: string) {
  ctx.fillStyle = color;
  for (const name of regions) {
    const rect = RECTS[name];
    if (!rect) continue;
    const [x, y, w, h] = place(rect);
    ctx.fillRect(x, y, w, h);
  }
}

/** Draws the jersey detail that only makes sense on the torso island. */
function paintTorso(ctx: CanvasRenderingContext2D, skin: Skin) {
  const [x, y, w, h] = place(RECTS.torso);

  if (skin.pinstripe) {
    ctx.strokeStyle = skin.pinstripe;
    ctx.lineWidth = Math.max(2, SIZE / 340);
    // Stripes run along v (down the body), so they are vertical lines here.
    for (let i = 1; i < 26; i++) {
      const sx = x + (i / 26) * w;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h);
      ctx.stroke();
    }
  }

  // Collar: the top of the island is the neck end of the spine.
  ctx.fillStyle = skin.trim;
  ctx.fillRect(x, y, w, h * 0.045);

  // Placket down the chest.
  const chestX = x + FACING.chest * w;
  ctx.fillRect(chestX - w * 0.008, y, w * 0.016, h * 0.55);

  // Number between the shoulders.
  if (skin.number) {
    const backX = x + FACING.back * w;
    const backY = y + h * 0.33;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(h * 0.26)}px "Oswald", system-ui, sans-serif`;
    ctx.lineWidth = Math.max(3, h * 0.02);
    ctx.strokeStyle = skin.trim;
    ctx.fillStyle = skin.jersey;
    // Outline first, then fill: a trim-coloured halo reads at any distance,
    // where a flat number on a same-value jersey disappears.
    ctx.strokeText(skin.number, backX, backY);
    ctx.fillText(skin.number, backX, backY);
    ctx.restore();
  }
}

/*
 * One texture per skin, kept for the life of the page. The scene remounts on
 * every pitch, so building these per mount would repaint three 1024² canvases
 * each time; there are only a handful of skins, so caching them outright is
 * both cheaper and simpler than reference-counting disposal.
 */
const CACHE = new Map<string, THREE.CanvasTexture>();

export function getUniformTexture(skin: Skin): THREE.CanvasTexture {
  const hit = CACHE.get(skin.id);
  if (hit) return hit;
  const tex = makeUniformTexture(skin);
  CACHE.set(skin.id, tex);
  return tex;
}

/** Builds the uniform texture for a skin. Prefer `getUniformTexture`. */
export function makeUniformTexture(skin: Skin): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Anything the unwrap didn't cover still samples somewhere — start from the
  // jersey so a stray triangle reads as cloth rather than a hole.
  ctx.fillStyle = skin.jersey;
  ctx.fillRect(0, 0, SIZE, SIZE);

  fill(ctx, KIT.jersey, skin.jersey);
  fill(ctx, KIT.sleeve, skin.sleeve);
  fill(ctx, KIT.skin, skin.skin);
  fill(ctx, KIT.pants, skin.pants);
  fill(ctx, KIT.socks, skin.socks);
  fill(ctx, KIT.shoes, skin.shoes);
  paintTorso(ctx, skin);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // The islands are padded, but clamping stops a filtered edge from wrapping
  // to the opposite side of the sheet.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * The visiting kit. Pitcher and catcher wear what the player picked, so the
 * batter has to be someone else — stepping the list keeps the two sides
 * distinguishable whichever skin is chosen.
 */
export function awaySkinFor(home: Skin): Skin {
  const i = SKINS.findIndex((s) => s.id === home.id);
  return SKINS[(i + 2) % SKINS.length];
}
