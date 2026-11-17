import React from "react";
import { areaCaptureSupported } from "../capture";
import { Icon } from "../../components/Icon";
import { SheetToggle } from "../../components/Primitives";
import { DEFAULT_AREA } from "./recording-media";
import { RecoveryPrompt, type RecoveryProps } from "./RecoveryPrompt";

export function RecordFlow({
  siteUrlField,
  ...recovery
}: RecoveryProps & { siteUrlField: React.ReactNode }) {
  const {
    microphone,
    setMicrophone,
    requestingCapture,
    recording,
    selectArea,
    setSelectArea,
    setArea,
    screenSupported,
    microphoneSupported,
  } = recovery.recorder;
  return (
    <section className="flow-stack" aria-label="Screen recording">
      {recording === "idle" && (
        <>
          <div className="sheet-group">
            <SheetToggle
              label="Record my voice"
              hint={
                (microphone
                  ? "Talk as you go. Your microphone is the sound in the recording."
                  : "Off: the video is silent, and you can add an AI walkthrough after it's saved.") +
                (!microphoneSupported
                  ? " This browser cannot use a microphone here."
                  : "")
              }
              checked={microphone}
              onChange={setMicrophone}
              disabled={
                requestingCapture || !microphoneSupported || !screenSupported
              }
            />
            {areaCaptureSupported && (
              <SheetToggle
                label="Record only part of it"
                hint={
                  selectArea
                    ? "After you pick, drag and resize a box over the part you want, then press Start recording."
                    : "Off: a shared tab starts recording as soon as you pick it."
                }
                checked={selectArea}
                onChange={(value) => {
                  setSelectArea(value);
                  if (value) setArea((current) => current ?? DEFAULT_AREA);
                }}
                disabled={requestingCapture || !screenSupported}
              />
            )}
          </div>
          {!microphone && siteUrlField}
          <ol className="sheet-steps" aria-label="How recording works">
            <li>
              <Icon name="fullscreen" />
              Pick a screen, window or tab
            </li>
            <li>
              <Icon name="selectArea" />
              Record all of it or an area
            </li>
            <li>
              <Icon name="record" />
              Stop, and it saves to Vistralo
            </li>
          </ol>
          <p className="flow-caption flow-muted">
            With Record my voice on, tab audio is left out. Maximum
            browser capture: 1 GB.
          </p>
          {!screenSupported && (
            <p className="sheet-note">
              <Icon name="info" />
              <span>
                Screen sharing needs a supported desktop browser on a
                secure connection. You can upload a video recorded with
                Vistralo desktop instead.
              </span>
            </p>
          )}
        </>
      )}
      {recording === "staging" && (
        <p className="sheet-status">
          <Icon name="spinner" />
          Saving a browser recovery copy…
        </p>
      )}
      {recording === "staged" && <RecoveryPrompt {...recovery} />}
    </section>
  );
}
