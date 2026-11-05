/**
 * Keeps the player's eye from walking into a standing passenger.
 *
 * Standing passengers stand in the aisle, and the walk code only knew about the aisle walls and
 * the gangway doors, so on a phone you could walk straight into (and through) one: the figure
 * filled the screen, its back faces were culled and the camera's near plane sliced the head.
 * Each standing passenger gets a small circle on the floor that the eye is pushed out of.
 */
export const PERSON_KEEP_OUT = 0.75; // metres, eye to the passenger's centre

export interface KeepOutCircle {
  x: number;
  z: number;
  r: number;
}

/**
 * Moves (x, z) to the edge of any circle it ended up inside. `prevX`/`prevZ` (where the eye was
 * before this step) picks the side to push toward when the point lands exactly on a centre.
 */
export function pushOutOfCircles(
  x: number,
  z: number,
  circles: readonly KeepOutCircle[],
  prevX = x,
  prevZ = z
): { x: number; z: number } {
  for (const c of circles) {
    let dx = x - c.x;
    let dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d >= c.r) continue;
    if (d < 1e-6) {
      dx = prevX - c.x;
      dz = prevZ - c.z;
      const pd = Math.hypot(dx, dz);
      if (pd < 1e-6) {
        dx = 0;
        dz = c.z > 0 ? -1 : 1;
      } else {
        dx /= pd;
        dz /= pd;
      }
    } else {
      dx /= d;
      dz /= d;
    }
    x = c.x + dx * c.r;
    z = c.z + dz * c.r;
  }
  return { x, z };
}
