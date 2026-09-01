# Model credits

`player.glb` — **Universal Animation Library** mannequin by
[Quaternius](https://quaternius.com), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain).

Processed for this project with `node tools/strip-glb.mjs`, which drops the 43
animation clips and repacks the binary chunk (7.6 MB → 0.62 MB). The clips are
unused: the skeleton is posed from code so the pitch mechanics stay tied to the
same geometry that decides the call.

`bat.glb` — a 33-inch wooden bat from the **Baseball Bats** pack, converted with
`node tools/fbx-to-glb.mjs`.

49 KB, texture included. The pack ships a 1024x1024 atlas shared by every bat
variant (2.18 MB), of which this bat uses a single 336x1011 strip. The converter
measures the mesh's own UV bounds, crops the atlas to that strip, downscales it
to 170x512 and re-encodes as JPEG — 22 KB, full detail where the bat actually
samples it — then rewrites the UVs over the crop.
