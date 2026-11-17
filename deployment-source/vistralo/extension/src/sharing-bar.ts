// Chrome's "… is sharing your screen · Stop sharing · Hide" bar. When an extension records the
// screen, Chrome floats this bar at the bottom centre of the screen's work area, and it is captured
// like any other window. (The web app's recordings get a different bar, at the top of its own
// window, which it cuts out in web/features/capture.ts.) The bar is found in the picture itself and
// painted over with the row just above it, so nothing else in the frame is lost. If the person
// presses Hide, or Chrome draws the bar elsewhere, nothing is found and nothing is painted.

/** Where the work area ends, and how frame pixels relate to screen points. */
export interface ScreenGeometry {
  /** Frame pixels per screen point. */
  scale: number;
  /** Bottom of the work area (above the taskbar), in frame pixels. */
  workBottom: number;
}

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The band of rows, in frame pixels, where the bar's top edge can be. */
export function searchBand(geo: ScreenGeometry) {
  const top = Math.max(0, Math.floor(geo.workBottom - 80 * geo.scale));
  return { top, rows: Math.max(0, Math.ceil(geo.workBottom - top)) };
}

/**
 * Finds the bar in a strip of RGBA pixels covering `searchBand`. Chrome draws it at a fixed place:
 * its top edge about 58 points above the end of the work area and its bottom border 5 to 8 points
 * above it, centred and a few hundred points wide, with a blue Stop sharing button in its right
 * half. All of that must be there, so a page's own toast, banner or video controls near the bottom
 * are left alone. If Chrome's theme turns the button another colour, the bar is not found and stays.
 */
export function findSharingBar(pixels: ArrayLike<number>, width: number, top: number, rows: number, geo: ScreenGeometry): BarRect | null {
  const lum = (x: number, y: number) => {
    const i = ((y - top) * width + x) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };
  const centre = Math.round(width / 2);
  // The bar's bottom border: a row, 5 to 8 points above the work area's end, that differs from the
  // rows above it all along the bar.
  const bottomBorder = (left: number, right: number) => {
    const from = Math.round(geo.workBottom - 11 * geo.scale);
    const to = Math.min(top + rows - 1, Math.round(geo.workBottom - 3 * geo.scale));
    const lift = Math.max(2, Math.round(3 * geo.scale));
    for (let y = from; y <= to; y++) {
      let differs = 0;
      let samples = 0;
      for (let x = left + 4; x <= right - 4; x += 8) {
        samples++;
        if (Math.abs(lum(x, y) - lum(x, y - lift)) > 8) differs++;
      }
      if (samples && differs / samples >= 0.8) return true;
    }
    return false;
  };
  // Chrome's blue Stop sharing button, in the bar's right half: blue well above red, in light and
  // dark themes alike. A page's own dark band with a bright edge and a thin line under it (a full-screen
  // video's controls) has everything else the bar has, but not this.
  const hasButton = (y: number, right: number) => {
    const from = Math.round(y + 8 * geo.scale);
    const to = Math.min(top + rows - 1, Math.round(y + 44 * geo.scale));
    let blue = 0;
    let samples = 0;
    for (let row = from; row <= to; row += 2) {
      for (let x = centre; x <= right; x += 3) {
        const i = ((row - top) * width + x) * 4;
        samples++;
        if (pixels[i + 2] - pixels[i] > 60 && pixels[i + 2] > 120) blue++;
      }
    }
    return samples > 0 && blue / samples >= 0.1;
  };
  const half = Math.round(150 * geo.scale);
  if (centre - half < 1 || centre + half >= width - 1) return null;
  const firstEdge = Math.max(top + 3, Math.round(geo.workBottom - 64 * geo.scale));
  const lastEdge = Math.min(top + rows, Math.round(geo.workBottom - 52 * geo.scale));
  // Rows just inside the bar, under its top border and above its text and button: one colour all
  // the way across, light or dark with Chrome's theme. The border itself is a single point, which
  // at fractional scales blends with whatever is above it, so the inside is what is looked for.
  // Only about five points of it are clear before the Stop sharing button starts.
  const insideFrom = Math.max(2, Math.round(2 * geo.scale));
  const insideRows = 3;
  const even = (y: number) => {
    const values: number[] = [];
    for (let x = centre - half; x <= centre + half; x += 2) values.push(lum(x, y));
    values.sort((p, q) => p - q);
    // The middle nine tenths: a few odd pixels (a thumbnail's edge bleeding in) do not count.
    const low = values[Math.floor(values.length * 0.05)];
    const high = values[Math.ceil(values.length * 0.95) - 1];
    if (high - low > 20) return -1;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
  };
  for (let y = firstEdge; y <= lastEdge; y++) {
    let mean = -1;
    let inside = true;
    for (let r = y + insideFrom; r < y + insideFrom + insideRows && inside; r++) {
      const m = even(r);
      if (m < 0 || (mean >= 0 && Math.abs(m - mean) > 4)) inside = false;
      else if (mean < 0) mean = m;
    }
    if (!inside) continue;
    // The border row differs from the inside along the bar.
    let change = 0;
    let samples = 0;
    for (let x = centre - half; x <= centre + half; x += 8) {
      change += Math.abs(lum(x, y) - mean);
      samples++;
    }
    if (change / samples < 8) continue;
    // The ends: walk out along each inside row until the bar's side borders. Chrome centres the bar,
    // so the end that reaches further gives both (a window over one end, or compression bleeding a
    // dark thumbnail into the bar, only shortens one side). The middle row's answer is kept, so one
    // row where a border is too faint to stop the walk does not decide.
    const reaches: number[] = [];
    for (let r = y + insideFrom; r < y + insideFrom + insideRows; r++) {
      let left = centre;
      while (left > 0 && Math.abs(lum(left - 1, r) - mean) <= 10) left--;
      let right = centre;
      while (right < width - 1 && Math.abs(lum(right + 1, r) - mean) <= 10) right++;
      reaches.push(Math.max(centre - left, right - centre));
    }
    reaches.sort((p, q) => p - q);
    const reach = reaches[Math.floor(reaches.length / 2)];
    const left = Math.max(0, centre - reach);
    const right = Math.min(width - 1, centre + reach);
    const span = right - left + 1;
    if (span < 250 * geo.scale || span > 900 * geo.scale) continue;
    if (!bottomBorder(left, right)) continue;
    if (!hasButton(y, right)) continue;
    // A little wider than the edge found: its shadow, or a sliver beside a window covering one end.
    const margin = Math.round(12 * geo.scale);
    const x = Math.max(0, left - margin);
    const y0 = Math.max(1, y - 4);
    return { x, y: y0, width: Math.min(width, right + 1 + margin) - x, height: Math.round(geo.workBottom) - y0 };
  }
  return null;
}

/**
 * Paints over the bar with what is around it: each column fades from the pixel just above the bar to
 * the one just below it, then the patch is softened together with a margin of the real picture, so
 * it takes on the colours on every side instead of standing out as a box.
 */
export function fillGap(context: OffscreenCanvasRenderingContext2D, bar: BarRect, scale: number) {
  const canvas = context.canvas;
  // Worked at a quarter of the size and scaled back up: a sixteenth of the pixels to blend and blur,
  // and the scaling itself smooths what is left of the column streaks.
  const q = 4;
  const pad = Math.round(16 * scale);
  const ex = Math.max(0, bar.x - pad);
  const ey = Math.max(0, bar.y - pad);
  const ew = Math.min(canvas.width, bar.x + bar.width + pad) - ex;
  const eh = Math.min(canvas.height, bar.y + bar.height + pad) - ey;
  const sw = Math.ceil(ew / q);
  const sh = Math.ceil(eh / q);
  const ix = (bar.x - ex) / q;
  const iy = (bar.y - ey) / q;
  const iw = bar.width / q;
  const ih = bar.height / q;
  const below = Math.min(canvas.height - 1, bar.y + bar.height - 2);
  const [work, low, soft] = scratch(sw, sh, Math.ceil(iw), Math.ceil(ih));
  work.globalCompositeOperation = "source-over";
  work.drawImage(canvas, ex, ey, ew, eh, 0, 0, sw, sh);
  // Each column fades from the pixel above the bar to the one below it.
  work.drawImage(canvas, bar.x, bar.y - 1, bar.width, 1, ix, iy, iw, ih);
  low.globalCompositeOperation = "source-over";
  low.clearRect(0, 0, low.canvas.width, low.canvas.height);
  low.drawImage(canvas, bar.x, below, bar.width, 1, 0, 0, iw, ih);
  low.globalCompositeOperation = "destination-in";
  const fade = low.createLinearGradient(0, 0, 0, ih);
  fade.addColorStop(0, "rgba(0, 0, 0, 0)");
  fade.addColorStop(1, "rgba(0, 0, 0, 1)");
  low.fillStyle = fade;
  low.fillRect(0, 0, iw, ih);
  work.drawImage(low.canvas, 0, 0, iw, ih, ix, iy, iw, ih);
  // Softened together with a margin of the real picture, over an unsoftened copy so the patch's own
  // edges never fade to the bar underneath.
  soft.filter = "none";
  soft.drawImage(work.canvas, 0, 0);
  soft.filter = `blur(${Math.max(1, Math.round((8 * scale) / q))}px)`;
  soft.drawImage(work.canvas, 0, 0);
  soft.filter = "none";
  // The patch reaches 12 points past each end of the bar; its outer 8 points fade into the real
  // picture there, so its sides are not hard edges.
  low.globalCompositeOperation = "copy";
  low.drawImage(soft.canvas, ix, iy, iw, ih, 0, 0, iw, ih);
  low.globalCompositeOperation = "destination-in";
  const feather = Math.min(0.45, (8 * scale) / q / iw);
  const sides = low.createLinearGradient(0, 0, iw, 0);
  sides.addColorStop(0, "rgba(0, 0, 0, 0)");
  sides.addColorStop(feather, "rgba(0, 0, 0, 1)");
  sides.addColorStop(1 - feather, "rgba(0, 0, 0, 1)");
  sides.addColorStop(1, "rgba(0, 0, 0, 0)");
  low.fillStyle = sides;
  low.fillRect(0, 0, iw, ih);
  low.globalCompositeOperation = "source-over";
  context.imageSmoothingQuality = "high";
  context.drawImage(low.canvas, 0, 0, iw, ih, bar.x, bar.y, bar.width, bar.height);
}

let scratchCanvases: [OffscreenCanvasRenderingContext2D, OffscreenCanvasRenderingContext2D, OffscreenCanvasRenderingContext2D] | null = null;
function scratch(ew: number, eh: number, w: number, h: number) {
  if (!scratchCanvases) {
    // On the CPU like the frame canvas, so nothing is copied to and from the GPU each frame.
    const make = () => new OffscreenCanvas(2, 2).getContext("2d", { willReadFrequently: true })!;
    scratchCanvases = [make(), make(), make()];
  }
  const [work, low, soft] = scratchCanvases;
  for (const [c, cw, ch] of [[work, ew, eh], [low, w, h], [soft, ew, eh]] as const)
    if (c.canvas.width !== cw || c.canvas.height !== ch) {
      c.canvas.width = cw;
      c.canvas.height = ch;
    }
  return scratchCanvases;
}

/** How often the picture is searched again, in milliseconds: the bar moves only when it is hidden
 * or shown. Timed, not counted in frames: a still screen sends very few frames. */
const SEARCH_EVERY_MS = 500;

/**
 * A copy of a screen track with the sharing bar painted out. Only for a whole screen that is
 * this screen (the bar's position is known only there); anything else is returned unchanged.
 */
export function withoutSharingBar(source: MediaStreamTrack, display: { width: number; height: number; availTop: number; availHeight: number }) {
  const g = globalThis as unknown as {
    MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
    MediaStreamTrackGenerator?: new (init: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };
  };
  const surface = (source.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  if (surface !== "monitor" || !g.MediaStreamTrackProcessor || !g.MediaStreamTrackGenerator || typeof OffscreenCanvas !== "function")
    return { track: source, stop: () => {} };
  const processor = new g.MediaStreamTrackProcessor({ track: source });
  const generator = new g.MediaStreamTrackGenerator({ kind: "video" });
  const abort = new AbortController();
  const canvas = new OffscreenCanvas(2, 2);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;
  let searched = -Infinity;
  let bar: BarRect | null = null;
  const transform = new TransformStream<VideoFrame, VideoFrame>({
    transform(frame, controller) {
      try {
        const width = frame.displayWidth;
        const height = frame.displayHeight;
        const scale = width / display.width;
        // Another screen than this one: the bar is not where this screen puts it.
        if (Math.abs(height - display.height * scale) > 4) {
          controller.enqueue(frame.clone());
          return;
        }
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          searched = -Infinity;
        }
        context.drawImage(frame, 0, 0);
        const now = performance.now();
        if (now - searched >= SEARCH_EVERY_MS) {
          searched = now;
          const geo = { scale, workBottom: (display.availTop + display.availHeight) * scale };
          const band = searchBand(geo);
          bar = band.rows > 0 ? findSharingBar(context.getImageData(0, band.top, width, band.rows).data, width, band.top, band.rows, geo) : null;
        }
        if (bar) fillGap(context, bar, scale);
        controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp, ...(frame.duration ? { duration: frame.duration } : {}) }));
      } finally {
        frame.close();
      }
    },
  });
  processor.readable
    .pipeThrough(transform, { signal: abort.signal })
    .pipeTo(generator.writable, { signal: abort.signal })
    .catch(() => {});
  source.addEventListener("ended", () => generator.stop(), { once: true });
  return {
    track: generator as MediaStreamTrack,
    stop() {
      abort.abort();
      generator.stop();
    },
  };
}
