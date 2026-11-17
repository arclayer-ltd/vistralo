// The camera bubble's contents: an extension page, so the camera permission belongs to Vistralo
// and the recorded website never receives the camera stream.
import { CAMERA_PORT, iceGathered, isCameraRelayMessage } from "./messages";

const device = decodeURIComponent(location.hash.slice(1));
const video = document.querySelector("video")!;

/** The page's Permissions-Policy, as Chrome applies it to this frame. */
const policy = (document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy;

function direct() {
  return navigator.mediaDevices.getUserMedia({
    video: { ...(device && device !== "default" ? { deviceId: { exact: device } } : {}), width: { ideal: 640 }, height: { ideal: 640 } },
    audio: false,
  });
}

/**
 * The page forbids the camera in its frames, so the engine opens it and streams it here over a
 * WebRTC connection that never leaves this computer (no servers are configured, so only this
 * machine's own addresses are offered). Closing the frame closes the port, and the engine then
 * stops the camera.
 */
function relayed() {
  return new Promise<MediaStream>((resolve, reject) => {
    const pc = new RTCPeerConnection();
    pc.addTransceiver("video", { direction: "recvonly" });
    const port = chrome.runtime.connect({ name: CAMERA_PORT });
    const fail = () => {
      pc.close();
      reject(new Error("The camera could not be relayed."));
    };
    pc.ontrack = (event) => resolve(event.streams[0] ?? new MediaStream([event.track]));
    port.onDisconnect.addListener(fail);
    port.onMessage.addListener((message: unknown) => {
      if (!isCameraRelayMessage(message)) return;
      if (message.type === "answer") void pc.setRemoteDescription({ type: "answer", sdp: message.sdp }).catch(fail);
      else if (message.type === "error") fail();
    });
    void (async () => {
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc);
      port.postMessage({ type: "offer", sdp: pc.localDescription!.sdp, camera: device || "default" });
    })().catch(fail);
  });
}

void (async () => {
  try {
    let stream: MediaStream;
    if (policy && !policy.allowsFeature("camera")) stream = await relayed();
    else {
      try {
        stream = await direct();
      } catch {
        // Some pages block the camera in ways the policy check does not show; try the engine once.
        stream = await relayed();
      }
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    // The bubble is removed with its frame; stop the camera with it.
    window.addEventListener("pagehide", () => stream.getTracks().forEach((t) => t.stop()));
  } catch {
    document.body.classList.add("is-off");
  }
})();
