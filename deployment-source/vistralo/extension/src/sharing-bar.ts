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
 * Finds the bar in a strip of RGBA pixels covering `searchBand`. The bar's top edge is a
 * horizontal line of one colour across the middle of the screen, unlike the rows just above it;
 * it is centred, a few hundred points wide, and the bar runs down to the end of the work area.
 */
export function findSharingBar(pixels: ArrayLike<number>, width: number, top: number, rows: number, geo: ScreenGeometry): BarRect | null {
  const lum = (x: number, y: number) => {
    const i = ((y - top) * width + x) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };
  const centre = Math.round(width / 2);
  const half = Math.round(150 * geo.scale);
  if (centre - half < 1 || centre + half >= width - 1) return null;
  const lastEdge = top + rows - Math.round(30 * geo.scale);
  for (let y = top + 3; y < lastEdge; y++) {
    let min = 255;
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let x = centre - half; x <= centre + half; x += 2) {
      const v = lum(x, y);
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count++;
    }
    if (max - min > 6) continue;
    const mean = sum / count;
    let change = 0;
    let samples = 0;
    for (let x = centre - half; x <= centre + half; x += 8) {
      change += Math.abs(lum(x, y - 3) - lum(x, y));
      samples++;
    }
    if (change / samples < 8) continue;
    let left = centre - half;
    while (left > 0 && Math.abs(lum(left - 1, y) - mean) <= 8) left--;
    let right = centre + half;
    while (right < width - 1 && Math.abs(lum(right + 1, y) - mean) <= 8) right++;
    const span = right - left + 1;
    if (span < 250 * geo.scale || span > 900 * geo.scale) continue;
    // Centred, give or take a window that covers one end of it.
    if (Math.abs((left + right) / 2 - centre) > 40 * geo.scale) continue;
    // A little wider than the edge found: its shadow, or a sliver beside a window covering one end.
    const margin = Math.round(12 * geo.scale);
    const x = Math.max(0, left - margin);
    const y0 = Math.max(1, y - 4);
    return { x, y: y0, width: Math.min(width, right + 1 + margin) - x, height: Math.round(geo.workBottom) - y0 };
  }
  return null;
}

/** The commonest colour in a row of RGBA pixels, as a CSS colour. */
export function commonColour(row: ArrayLike<number>) {
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i + 2 < row.length; i += 4) {
    // Nearby shades count as one, so antialiasing and compression noise do not split the vote.
    const key = ((row[i] >> 3) << 10) | ((row[i + 1] >> 3) << 5) | (row[i + 2] >> 3);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > bestCount) {
      bestCount = n;
      best = i;
    }
  }
  return `rgb(${row[best]} ${row[best + 1]} ${row[best + 2]})`;
}

/** How often the picture is searched again: the bar moves only when it is hidden or shown. */
const SEARCH_EVERY = 15;

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
  let frames = 0;
  let bar: BarRect | null = null;
  let fill = "";
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
          frames = 0;
        }
        context.drawImage(frame, 0, 0);
        if (frames++ % SEARCH_EVERY === 0) {
          const geo = { scale, workBottom: (display.availTop + display.availHeight) * scale };
          const band = searchBand(geo);
          bar = band.rows > 0 ? findSharingBar(context.getImageData(0, band.top, width, band.rows).data, width, band.top, band.rows, geo) : null;
          if (bar) fill = commonColour(context.getImageData(bar.x, bar.y - 1, bar.width, 1).data);
        }
        // One flat colour, the commonest just above the bar: stretching that row would drag
        // every edge it crosses down into streaks.
        if (bar) {
          context.fillStyle = fill;
          context.fillRect(bar.x, bar.y, bar.width, bar.height);
        }
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
