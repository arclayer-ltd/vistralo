import type { ProjectSource } from "../contracts";

/**
 * The four ways to start a project, named by what the person does. Saving any of them never
 * starts paid AI; an AI walkthrough is added afterwards, from the project.
 */
export type StartFlow = "screen" | "website" | "video" | "images";

/**
 * Names from before the create actions were merged. A recording handed over by the Chrome
 * extension, or a Record choice remembered in a browser, may still use one; each opens the
 * flow it became, with the same starting options.
 */
export type LegacyFlow =
  | "ai-walkthrough"
  | "talk-through"
  | "section"
  | "narrate-video"
  | "narrate-screenshots";

export type CreateFlow = StartFlow | LegacyFlow;

export interface CreateFlowItem {
  flow: StartFlow;
  source: ProjectSource;
  /** The verb on buttons and menus: "Record your screen". */
  label: string;
  /** What the project is called once made, on cards, filters and the project header. */
  kind: string;
  /** The plural, for filters and counts. */
  kinds: string;
  description: string;
  icon: string;
  key?: string;
}

export const createFlows: CreateFlowItem[] = [
  {
    flow: "screen",
    source: "screen",
    label: "Record your screen",
    kind: "Screen recording",
    kinds: "Screen recordings",
    description: "Capture a screen, window or tab, with your voice if you like.",
    icon: "record",
    key: "R",
  },
  {
    flow: "website",
    source: "web",
    label: "Record a website",
    kind: "Website",
    kinds: "Websites",
    description: "Type an address and Vistralo scrolls and records the site for you.",
    icon: "globe",
    key: "W",
  },
  {
    flow: "video",
    source: "upload",
    label: "Upload a video",
    kind: "Video",
    kinds: "Videos",
    description: "Start from a recording you already have.",
    icon: "upload",
    key: "U",
  },
  {
    flow: "images",
    source: "upload",
    label: "Add images",
    kind: "Images",
    kinds: "Images",
    description: "Turn screenshots into a video, one screen at a time.",
    icon: "image",
    key: "I",
  },
];

/** Kept for callers that list the recording ways apart from the rest. */
export const recordFlows = createFlows.slice(0, 1);
export const materialFlows = createFlows.slice(1);

const LEGACY: Record<LegacyFlow, StartFlow> = {
  "ai-walkthrough": "screen",
  "talk-through": "screen",
  section: "screen",
  "narrate-video": "video",
  "narrate-screenshots": "images",
};

/** The flow a name opens today: a legacy name becomes the flow it was merged into. */
export const startFlow = (flow: CreateFlow): StartFlow =>
  (LEGACY as Record<string, StartFlow>)[flow] ?? (flow as StartFlow);

export const flowFor = (flow: CreateFlow) =>
  createFlows.find((item) => item.flow === startFlow(flow))!;

/** The steps a flow walks through, in order. The last one is always saving to Vistralo. */
export const flowSteps: Record<StartFlow, string[]> = {
  screen: ["Set up", "Record", "Save"],
  website: ["Address", "Options", "Save"],
  video: ["Choose a video", "Save"],
  images: ["Choose images", "Save"],
};
