import * as labels from "../../src/project-labels.cjs";
export const MAX_UPLOAD_BYTES = 20 * 1024 ** 3;
export const MAX_CLOUD_UPLOAD_BYTES = 50 * 1024 ** 3;
export const MAX_BROWSER_RECORDING_BYTES = 1024 ** 3;

/** The most a reviewed walkthrough stop may say; the worker enforces the same limit. */
export const STOP_TEXT_LIMIT = 2000;

export type WalkthroughStop = { at: number; label?: string; text?: string; frame?: string | null };

/**
 * Applies the owner's edits to a drafted walkthrough script. Every screen keeps its place and
 * timing; only the words change. An empty stop is silent, and the film plays through it.
 */
export function walkthroughScriptEdit<S extends WalkthroughStop>(
  draft: { stops: S[] },
  stops: unknown,
  closing: unknown,
): { stops: S[]; closing: string } {
  if (!Array.isArray(stops) || stops.length !== draft.stops.length)
    throw new Error("The script changed while you were editing. Reload the project and try again.");
  const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
  const texts = stops.map((stop) => clean((stop as { text?: unknown } | null)?.text));
  const closingText = clean(closing);
  const long = [...texts, closingText].findIndex((text) => text.length > STOP_TEXT_LIMIT);
  if (long >= 0)
    throw new Error(
      long < texts.length
        ? `Screen ${long + 1} is longer than ${STOP_TEXT_LIMIT} characters.`
        : `The closing is longer than ${STOP_TEXT_LIMIT} characters.`,
    );
  return { stops: draft.stops.map((stop, i) => ({ ...stop, text: texts[i] })), closing: closingText };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * The name a project gets when the person did not type one: what was recorded (the tab's title,
 * the website, the file's own name), never the date, which the card already shows.
 */
export function automaticName(options: Parameters<typeof labels.automaticName>[0]): string {
  return labels.automaticName(options).slice(0, 120);
}

/** What a new project records about its name: whether Vistralo chose it, and what it was chosen from. */
export function namingData(input: {
  autoName?: boolean;
  pageTitle?: string;
  sourceName?: string;
  origin?: string;
}): Record<string, unknown> {
  const clean = (value?: string) =>
    typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, 300) : undefined;
  const data: Record<string, unknown> = {};
  // A video made from images is uploaded like any other video; this is how it is told apart later.
  if (input.origin === "images") data.origin = "images";
  if (typeof input.autoName === "boolean") data.autoName = input.autoName;
  if (clean(input.pageTitle)) data.pageTitle = clean(input.pageTitle);
  if (clean(input.sourceName)) data.sourceName = clean(input.sourceName);
  return data;
}

/** A project's data after a patch: a name the owner sets is theirs, and nothing replaces it. */
export function renamed<D extends Record<string, any>>(
  project: { name: string; data: D },
  patch: { name?: string },
): D {
  return patch.name !== undefined && patch.name !== project.name
    ? { ...project.data, autoName: false }
    : project.data;
}

export type ProjectKind = "screen" | "website" | "video" | "images";

/** Names Vistralo gave image projects before they were marked: "6 screenshots", "Screenshots 2026-…Z". */
const IMAGE_NAMES = /^(\d+ screenshots?|screenshots \d{4}-\d{2}-\d{2}T[\d-]+Z)$/i;

/**
 * What a project was made from, in the words of the action that made it: a screen recording, a
 * website, an uploaded video or a set of images.
 */
export function projectKind(p: {
  source: string;
  name?: string;
  data?: Record<string, any> | null;
}): ProjectKind {
  if (p.source === "web") return "website";
  if (p.source === "screen") return "screen";
  if (p.data?.origin === "images" || IMAGE_NAMES.test(String(p.name || "").trim())) return "images";
  return "video";
}

/** The name of each kind on a card, the project header and filters. */
export const KIND_LABELS: Record<ProjectKind, { one: string; many: string; icon: string }> = {
  screen: { one: "Screen recording", many: "Screen recordings", icon: "record" },
  website: { one: "Website", many: "Websites", icon: "globe" },
  video: { one: "Video", many: "Videos", icon: "video" },
  images: { one: "Images", many: "Images", icon: "image" },
};

/** Why a typed address cannot be recorded, in a sentence, or "" when it can (or nothing is typed yet). */
export function websiteProblem(raw: string): string {
  if (!raw.trim()) return "";
  try {
    publicWebsite(raw);
    return "";
  } catch (failure) {
    return errorMessage(failure);
  }
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * What an AI walkthrough of a video this long is likely to cost, priced the way the worker prices
 * it before any paid call: the script (about 10 cents plus under a cent a screen), then the voice
 * for the words the film has room for. The screen count is a guess until the worker has looked,
 * so this is an estimate; the worker's own check against the cost cap is what decides.
 */
export function aiWalkthroughEstimate(duration?: number | null) {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;
  const screens = Math.min(60, Math.max(1, Math.round(duration / 6)));
  const words = Math.round(Math.max(60, Math.min(3 * duration, 360) - duration - screens * 0.5) * 2.4);
  const script = 0.1 + screens * 0.008;
  const voice = Math.max(screens * 0.01, Math.max(0.01, ((words * 6) / 1000) * 0.02));
  return { screens, script: cents(script), voice: cents(voice), total: cents(script + voice) };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const value = Math.floor(seconds),
    h = Math.floor(value / 3600),
    m = Math.floor(value / 60) % 60,
    s = value % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function validateVideo(file: File, cloud = false): void {
  if (!file.size) throw new Error("Choose a video that is not empty.");
  if (!/\.(mp4|webm|mov|mkv)$/i.test(file.name))
    throw new Error("Choose an MP4, WebM, MOV or MKV video.");
  if (file.size > (cloud ? MAX_CLOUD_UPLOAD_BYTES : MAX_UPLOAD_BYTES))
    throw new Error(
      `This video exceeds the ${cloud ? 50 : 20} GB upload limit.`,
    );
}

export function publicWebsite(raw: string): string {
  const typed = raw.trim();
  // People type "example.com"; only an explicit scheme (not a port) is kept as written.
  const address = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(typed)
    ? typed
    : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Enter a website address, such as example.com.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Use an HTTP or HTTPS URL without a username or password.");
  if (
    url.hostname === "localhost" ||
    /^(127\.|10\.|192\.168\.|0\.)/.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
    url.hostname.includes(":") ||
    !url.hostname.includes(".")
  )
    throw new Error(
      "Enter a public website. Private network addresses cannot be analyzed by the server.",
    );
  return url.href;
}

export function downloadText(
  text: string,
  filename: string,
  type = "text/markdown;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._ -]/g, "")
      .trim()
      .slice(0, 100) || "Vistralo project"
  );
}

/** Validate the user's reviewable trim plan before it reaches the media API. */
export function buildClipPlan(
  source: string,
  duration: number | null,
  clips: { start: string | number; end: string | number }[],
) {
  if (!source.trim()) throw new Error("Choose a source recording first.");
  if (!duration || !Number.isFinite(duration) || duration < 0)
    throw new Error(
      "Wait for the source duration to be verified before saving a trim plan.",
    );
  if (!clips.length || clips.length > 200)
    throw new Error("Keep between 1 and 200 parts.");
  let previousEnd = 0;
  return {
    version: 1 as const,
    source,
    clips: clips.map((part, index) => {
      const start = Number(part.start),
        end = Number(part.end);
      if (
        !String(part.start).trim() ||
        !String(part.end).trim() ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        end > duration
      )
        throw new Error(
          `Part ${index + 1} must start at or after 0, end after its start, and stay within ${duration.toFixed(3)} seconds.`,
        );
      if (start < previousEnd)
        throw new Error(
          `Part ${index + 1} starts before part ${index} ends. Keep the parts in order.`,
        );
      previousEnd = end;
      return { start, end };
    }),
  };
}
