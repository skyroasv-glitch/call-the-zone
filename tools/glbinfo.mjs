import { readFileSync } from "node:fs";

const buf = readFileSync(process.argv[2]);
if (buf.toString("utf8", 0, 4) !== "glTF") throw new Error("not a glb");
let off = 12, json = null, binLen = 0;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.toString("utf8", off + 4, off + 8);
  if (type.startsWith("JSON")) json = JSON.parse(buf.toString("utf8", off + 8, off + 8 + len));
  else binLen = len;
  off += 8 + len;
}

const nodes = json.nodes ?? [];
console.log(`meshes ${json.meshes?.length}  skins ${json.skins?.length}  nodes ${nodes.length}`,
            `animations ${json.animations?.length}  bin ${(binLen / 1e6).toFixed(2)}MB`);

if (process.argv[3] === "--tree") {
  const childOf = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => childOf.set(c, i)));
  const roots = nodes.map((_, i) => i).filter((i) => !childOf.has(i));
  const walk = (i, d) => {
    const n = nodes[i];
    const t = n.translation ? n.translation.map((v) => +v.toFixed(3)).join(",") : "-";
    console.log(`${"  ".repeat(d)}${n.name ?? "(unnamed)"}  t[${t}]`);
    (n.children ?? []).forEach((c) => walk(c, d + 1));
  };
  roots.forEach((r) => walk(r, 0));
} else {
  console.log("\nanimations:");
  (json.animations ?? []).forEach((a, i) => console.log(`  ${String(i).padStart(3)}  ${a.name}`));
}
