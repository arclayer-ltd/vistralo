// Types for retention.cjs, which the web app bundles.
export interface RetainedProject {
  created?: string;
  created_at?: string;
  retainFrom?: string;
}
export interface RetentionSettings {
  enabled: boolean;
  /** ISO time: projects made before it count their months from it. */
  graceStart?: string | null;
  grace_start?: string | null;
}
export interface DeletionNotice {
  /** When the project is deleted, in ms since the epoch. */
  at: number;
  daysLeft: number;
  due: boolean;
  soon: boolean;
}
export declare const RETENTION_MONTHS: number;
export declare const WARNING_DAYS: number;
export declare function addMonthsUTC(time: number, months: number): number;
export declare function retainedFrom(project: RetainedProject): number | null;
export declare function expiresAt(project: RetainedProject, settings?: Partial<RetentionSettings> | null): number | null;
export declare function deletionNotice(project: RetainedProject, settings: RetentionSettings | null | undefined, now?: number): DeletionNotice | null;
export declare function retainFromForCopy(original: RetainedProject): string | undefined;
