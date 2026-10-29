# Blender models for Mom, Dad and passengers (optional, off by default)

The game's people are procedural (design doc v5.3 §2.2, "no asset files"). This relaxes that rule
**only behind a flag** and only for Mom and Dad: with the flag on, the game loads
`public/models/characters/mom.glb` and `dad.glb` before the car is built. If either one is missing
or doesn't fit the contract below, that parent stays procedural and the console logs a `[models]`
warning. Production and offline builds ship no model files (`*.glb` there is gitignored), and the
offline build never tries to load models.

## Turn it on (local / web builds)
1. Put `mom.glb` and/or `dad.glb` in `public/models/characters/`.
2. Open the game with `?models=parents` in the URL, or run
   `localStorage.setItem('gtrain-glb-parents', '1')` in the console and reload.

## Starting point
`bun run export:glb` writes the procedural parents to `exports/character_parent_01_Mom.glb`
and `exports/character_parent_02_Dad.glb`. They already follow the contract, so import one into
Blender, edit it, and export it as glTF Binary (+Y up).

## Node contract
| Name | What it is | Why |
|---|---|---|
| `Head` | an empty or group with its **origin at the neck** | gaze, stares and the head twist rotate it (YXZ order is set at load) |
| `Eye_*` (e.g. `Eye_L`, `Eye_R`) | one or more meshes **inside `Head`**, the pupils | the frozen-face anomaly scales them ×2.2 |
| `Skin*` material | **exactly one** material, shared by every skin mesh | anomalies recolour it, so it needs a base colour |
| `Phone` | optional node | the frozen-face anomaly hides it |

Model it seated, facing **+Z**, in metres, with the feet at y = 0 and the origin between the
feet. The game places it in the parent's seat. The adapter rejects anything with no meshes, no
`Head`, no `Eye_*` mesh, zero or several `Skin` materials, a height outside 0.6–2.4 m, or a
`Head` pivot outside 0.7–2 m off the floor.

Materials are kept as imported (no PS1 or nearest-neighbour conversion). Keep each file small
(the exported parents are about 125–145 KB). No animation or skinning is used.

## Passengers (optional, separate flag)
Ordinary passengers (everyone except Mom and Dad) can use Blender models too, behind their own flag.
Turning on one flag doesn't turn on the other.

1. Put any of the files below in `public/models/characters/`.
2. Open the game with `?models=passengers` (both: `?models=parents,passengers` or `?models=all`),
   or run `localStorage.setItem('gtrain-glb-passengers', '1')` and reload.

Files are shared by **outfit and pose**, so one file covers everyone who wears that outfit in that
pose. Each person gets their own copy with their own materials, so recolouring one never changes another.

| File | Who uses it today |
|---|---|
| `passenger-mta.glb` | s1, the man across the aisle |
| `passenger-coat.glb` | s2, the woman on your bench |
| `passenger-puffer-standing.glb` | s3, the standing passenger |
| `passenger-plain.glb` | seat6 (the far seat) and c5 (no outfit) |
| `passenger-hoodie-standing.glb` | c1 |
| `passenger-hoodie.glb` | pc2 (Car C) |
| `passenger-texter.glb` | c2 |
| `passenger-texter-standing.glb` | pc1 (Car C) |
| `passenger-overcoat.glb` | c3, pa2 (Car A) |
| `passenger-office-standing.glb` | c4 |
| `passenger-office.glb` | pa1 (Car A) |

The node contract is the same as for the parents (`Head`, `Eye_*` inside `Head`, one `Skin*`
material, optional `Phone`, +Z forward, metres, feet at y = 0). Seated files are modelled seated.
`-standing` files are modelled standing, with the feet on the floor. If a file is missing or broken,
the people who use it stay procedural and the console logs a `[models]` warning.

Known limits: a model replaces the whole procedural body, so the small prop habits the procedural
figures have (newspaper page turns, phone thumb-flicks) are not added to models. Head habits and
gaze still work. Skinned meshes are cloned with SkeletonUtils, but no animation is played.
