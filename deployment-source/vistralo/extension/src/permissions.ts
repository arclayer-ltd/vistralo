// What a take needs from Chrome before it starts. Chrome asks for the microphone and camera in a
// page (the setup page), never in the popup or the recording engine, so a start without them would
// only fail later with a vaguer message. Chrome's "Allow this time" grant also ends when the setup
// page closes, which is how a camera that read "Allowed" stops working.
import type { StartOptions } from "./messages";

export type Device = "microphone" | "camera";
/** "unknown" when Chrome could not say; the engine then reports what happened itself. */
export type Access = PermissionState | "unknown";

/** The camera is used for a camera-only take and for the bubble on a tab, window or screen. */
export function usesCamera(options: Pick<StartOptions, "mode" | "camera" | "bubble">) {
  return options.camera !== null && (options.mode === "camera" || options.bubble);
}

export function missingPermissions(
  options: Pick<StartOptions, "mode" | "microphone" | "camera" | "bubble">,
  access: Record<Device, Access>,
): Device[] {
  const missing: Device[] = [];
  const lacks = (state: Access) => state === "prompt" || state === "denied";
  if (options.microphone !== null && lacks(access.microphone)) missing.push("microphone");
  if (usesCamera(options) && lacks(access.camera)) missing.push("camera");
  return missing;
}

export function permissionMessage(missing: Device[], access: Record<Device, Access>) {
  const what = missing.length === 2 ? "the microphone and the camera" : `the ${missing[0]}`;
  const blocked = missing.some((d) => access[d] === "denied");
  return blocked
    ? `Chrome is blocking ${what} for Vistralo. The setup page is open: allow it there, then start again.`
    : `Vistralo needs your permission to use ${what}. The setup page is open: allow it there and choose "Allow on every visit", then start again.`;
}

export async function readAccess(): Promise<Record<Device, Access>> {
  const read = async (name: Device): Promise<Access> => {
    try {
      return (await navigator.permissions.query({ name: name as PermissionName })).state;
    } catch {
      return "unknown";
    }
  };
  const [microphone, camera] = await Promise.all([read("microphone"), read("camera")]);
  return { microphone, camera };
}
