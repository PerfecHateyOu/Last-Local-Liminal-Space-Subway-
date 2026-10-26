# Blender models for Mom and Dad (optional, off by default)

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
