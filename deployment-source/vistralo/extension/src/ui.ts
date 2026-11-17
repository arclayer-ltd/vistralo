// Small DOM helpers for the extension's pages, which are plain HTML without a framework.

export function $<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Missing #${id}`);
  return element;
}

export function show(id: string, visible: boolean) {
  const element = document.getElementById(id);
  if (element) element.hidden = !visible;
}

export function button(label: string, onClick: () => void, className = "button") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** Device lists from the browser, labelled even before a label is known. */
export async function devices(kind: "audioinput" | "videoinput") {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const list = all.filter((d) => d.kind === kind && d.deviceId);
  return list.map((d, i) => ({
    id: d.deviceId,
    label: d.label || (kind === "audioinput" ? `Microphone ${i + 1}` : `Camera ${i + 1}`),
  }));
}

/** How many devices of a kind are plugged in. Before Chrome allows them they have no id, so the
 * lists above leave them out; counting them still tells the person a camera is there to allow. */
export async function deviceCount(kind: "audioinput" | "videoinput") {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  return all.filter((d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications").length;
}

export async function permission(name: "microphone" | "camera") {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return "prompt" as PermissionState;
  }
}
