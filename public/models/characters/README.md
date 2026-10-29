# Importing Custom Blender Models into LAST LOCAL

This folder (`public/models/characters/`) holds 3D character models exported from **Blender** (`.glb` or `.gltf`) that replace the in-game subway passengers, parents, and uncanny anomalies.

---

## Quick Start: Drop-in Blender Workflow

1. **Model in Blender**:
   - Keep polygon budget low for authentic PS1 horror aesthetics (~500 to 1,500 triangles per character).
   - Use low-res textures (64x64 or 128x128 pixels).
   - Character height: roughly 1.7m standing, 1.3m seated, origin (0, 0, 0) at the feet.

2. **Node Naming for Interactive Features**:
   To ensure gaze tracking, head turning, and flashlight reactions work seamlessly:
   - **Head Node**: Name your head object or bone `Head` (or `head`). The engine will automatically articulate this node so the passenger tracks the player's movements.
   - **Eye Meshes**: Name pupil / eye objects `Eye_L`, `Eye_R`, or `Pupil`. During uncanny anomalies or camera flashes, the engine dilates these meshes.
   - **Prop / Phone**: If the character holds a smartphone or newspaper, name the object `Phone` or `Prop`.
   - **Skin Material**: If you want Mom's uncanny pale-skin anomaly to recolor her face, name the skin material `skin` or `Skin`.

3. **Export from Blender**:
   - In Blender: `File` -> `Export` -> `glTF 2.0 (.glb/.gltf)`.
   - Format: **glTF Binary (.glb)** is recommended.
   - Include: `Selected Objects` (or visible objects).
   - Transform: `+Y Up`.

4. **Drop the File Here**:
   - Save directly into `public/models/characters/`.
   - Match the filename to `manifest.json` (e.g. `character_mom.glb`, `character_dad.glb`, `character_mta.glb`, `character_coat.glb`, etc.).
   - Alternatively, add custom model mappings in `public/models/characters/manifest.json`.

---

## Procedural Fallback Guarantee

If any model file is missing, currently being edited, or fails to parse, LAST LOCAL **instantly and seamlessly uses the built-in procedural PS1 figures**. The game will never crash, stutter, or display empty seats.
