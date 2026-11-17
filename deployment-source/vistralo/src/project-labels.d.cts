// Types for project-labels.cjs, which the web app bundles.
export interface NamedProject {
  id?: string;
  name?: string;
  type?: string;
  source?: string;
  url?: string;
  data?: Record<string, any>;
}
export interface FrameSample {
  time: number;
  mean: number;
  spread: number;
  coverage?: number;
}
export declare const MAX_NAME: number;
export declare function siteName(url: string): string;
export declare function pageTitle(raw: unknown): string;
export declare function fileTitle(fileName: unknown): string;
export declare function automaticName(options?: {
  flow?: string;
  source?: "screen" | "web" | "upload";
  url?: string;
  title?: string;
  fileName?: string;
  shotNames?: string[];
  shots?: number;
  spoken?: boolean;
}): string;
export declare function isAutomaticName(name: unknown): boolean;
export declare function nameIsOwners(project: NamedProject): boolean;
export declare function scriptLabel(data: Record<string, any> | undefined): string;
export declare function improvedName(project: NamedProject): string | null;
export declare function lumaStats(luma: ArrayLike<number>): { mean: number; spread: number; coverage: number };
export declare function rgbaLuma(pixels: ArrayLike<number>): number[];
export declare function usableFrame(sample: { mean: number; spread: number; coverage?: number }): boolean;
export declare function posterTimes(duration: number): number[];
export declare function chooseFrame<T extends FrameSample>(samples: T[]): T | null;
export declare function storedStills(project: NamedProject & { id: string }): string[];
