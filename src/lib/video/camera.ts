import type { CameraMove, RenderScene } from "./contract";

/**
 * Camera moves over a still (PLAN-build4 §1.8). Pure.
 *
 * The framing rule: the art is scaled to fit a box of `FOREGROUND_FIT` of the
 * frame (never cropped) over a blurred copy of itself, and the camera moves
 * the whole composite. The numbers below are chosen so that at every moment of
 * every move the art is still entirely inside the visible window — the camera
 * only ever crops blurred background. `visibleWindow()` is that claim as code,
 * and the unit tests check it.
 */

/** The art's box, as a share of the frame in each dimension. */
export const FOREGROUND_FIT = 0.9;
/** Largest zoom of a zoom move: ≤ 8 % scale change over the scene. */
export const MAX_ZOOM = 1.08;
/** Pans run at a constant zoom so there is room to travel… */
export const PAN_ZOOM = 1.05;
/** …and travel this share of the frame, centred on the middle. */
export const PAN_TRAVEL = 0.04;

/** Scenes without a move rotate through these, so consecutive scenes differ. */
export const DEFAULT_ROTATION: CameraMove[] = ["zoom_in", "pan_right", "zoom_out", "pan_left"];

/** The move per scene: the scene's own, else the rotation, never the same as the scene before. */
export function resolveCameras(scenes: Pick<RenderScene, "camera">[]): CameraMove[] {
  const out: CameraMove[] = [];
  let r = 0;
  for (const scene of scenes) {
    const prev = out[out.length - 1];
    if (scene.camera) {
      out.push(scene.camera);
      continue;
    }
    let pick = DEFAULT_ROTATION[r % DEFAULT_ROTATION.length];
    if (pick === prev) {
      r++;
      pick = DEFAULT_ROTATION[r % DEFAULT_ROTATION.length];
    }
    r++;
    out.push(pick);
  }
  return out;
}

/** Smoothstep easing: starts and ends at rest. */
export function ease(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return c * c * (3 - 2 * c);
}

/**
 * The visible window at progress `p` (0…1), as shares of the composite:
 * `{ zoom, x, y, w, h }` with x/y the window's top-left corner.
 */
export function visibleWindow(
  move: CameraMove,
  p: number,
): { zoom: number; x: number; y: number; w: number; h: number } {
  const e = ease(p);
  let zoom = 1;
  let dx = 0;
  let dy = 0;
  switch (move) {
    case "zoom_in":
      zoom = 1 + (MAX_ZOOM - 1) * e;
      break;
    case "zoom_out":
      zoom = MAX_ZOOM - (MAX_ZOOM - 1) * e;
      break;
    case "pan_left":
      zoom = PAN_ZOOM;
      dx = PAN_TRAVEL * (0.5 - e);
      break;
    case "pan_right":
      zoom = PAN_ZOOM;
      dx = PAN_TRAVEL * (e - 0.5);
      break;
    case "pan_up":
      zoom = PAN_ZOOM;
      dy = PAN_TRAVEL * (0.5 - e);
      break;
    case "pan_down":
      zoom = PAN_ZOOM;
      dy = PAN_TRAVEL * (e - 0.5);
      break;
    case "none":
      break;
  }
  const w = 1 / zoom;
  return { zoom, x: (1 - w) / 2 + dx, y: (1 - w) / 2 + dy, w, h: w };
}

function num(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * zoompan expressions for `move` over `frames` output frames. `on` is the
 * output frame number; the progress is eased with smoothstep. The window's
 * corner is computed in input pixels (`iw`, `ih`) from the same formula as
 * `visibleWindow()`, so the expressions and the safety check agree.
 */
export function zoompanExpressions(
  move: CameraMove,
  frames: number,
): { z: string; x: string; y: string } {
  const denom = Math.max(1, frames - 1);
  const p = `min(1,on/${denom})`;
  const e = `(${p})*(${p})*(3-2*(${p}))`;
  let z = "1";
  let dx = "0";
  let dy = "0";
  switch (move) {
    case "zoom_in":
      z = `1+${num(MAX_ZOOM - 1)}*${e}`;
      break;
    case "zoom_out":
      z = `${num(MAX_ZOOM)}-${num(MAX_ZOOM - 1)}*${e}`;
      break;
    case "pan_left":
      z = num(PAN_ZOOM);
      dx = `${num(PAN_TRAVEL)}*(0.5-${e})`;
      break;
    case "pan_right":
      z = num(PAN_ZOOM);
      dx = `${num(PAN_TRAVEL)}*(${e}-0.5)`;
      break;
    case "pan_up":
      z = num(PAN_ZOOM);
      dy = `${num(PAN_TRAVEL)}*(0.5-${e})`;
      break;
    case "pan_down":
      z = num(PAN_ZOOM);
      dy = `${num(PAN_TRAVEL)}*(${e}-0.5)`;
      break;
    case "none":
      break;
  }
  return {
    z,
    x: `iw*((1-1/zoom)/2+${dx})`,
    y: `ih*((1-1/zoom)/2+${dy})`,
  };
}
