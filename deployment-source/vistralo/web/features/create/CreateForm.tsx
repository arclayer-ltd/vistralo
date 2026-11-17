import React, { type RefObject } from "react";
import type {
  Project,
  ProjectSource,
  UploadProgress,
  WorkspaceAdapter,
} from "../../contracts";
import { flowFor, flowSteps, startFlow, type CreateFlow } from "../create-flows";
import { Icon } from "../../components/Icon";
import { SheetHeader } from "../../components/Primitives";
import { FlowSteps } from "./FlowSteps";
import type { Recorder } from "./useRecorder";

/** What each step asks for, under the sheet's title. */
const stepIntro: Record<string, string[]> = {
  screen: [
    "Choose what to share, record it, and it saves to Vistralo when you stop.",
    "Choose what to share, record it, and it saves to Vistralo when you stop.",
    "Your recording is ready to save to Vistralo.",
  ],
  website: [
    "Type the address of the website you want to record.",
    "Choose how the website is recorded.",
    "Check the details, then record the website.",
  ],
  video: [
    "Choose a recording from your computer: MP4, WebM, MOV or MKV.",
    "Name it if you like, then save it to Vistralo.",
  ],
  images: [
    "Choose screenshots in the order to show them. A tall full-page capture is shown one screen at a time.",
    "Vistralo turns the images into a video in this browser, then saves it.",
  ],
};

export function CreateForm({
  source,
  flow,
  adapter,
  recorder,
  name,
  setName,
  file,
  shots,
  screenshots,
  storageChecked,
  busy,
  progress,
  building,
  controller,
  created,
  error,
  step,
  canNext,
  nextBlocked,
  onNext,
  onBack,
  submit,
  close,
  children,
}: {
  source: ProjectSource;
  flow?: CreateFlow;
  adapter: WorkspaceAdapter;
  recorder: Recorder;
  name: string;
  setName: (name: string) => void;
  file: File | null;
  shots: File[];
  screenshots: boolean;
  storageChecked: boolean;
  busy: boolean;
  progress: UploadProgress | null;
  building: number | null;
  controller: RefObject<AbortController | null>;
  created: Project | null;
  error: string;
  /** The step on screen; for a screen recording it follows the recorder. */
  step: number;
  /** Whether what this step asks for is given, so Next may go on. */
  canNext: boolean;
  /** Next was pressed before the step was complete: show why, and put the cursor there. */
  nextBlocked: () => void;
  onNext: () => void;
  onBack: () => void;
  submit: (event: React.FormEvent) => void;
  close: () => Promise<void>;
  children: React.ReactNode;
}) {
  const {
    spoken,
    requestingCapture,
    recording,
    activeRecording,
    screenSupported,
    chooseSource,
  } = recorder;
  const kind = flow
    ? startFlow(flow)
    : source === "web"
      ? "website"
      : source === "screen"
        ? "screen"
        : "video";
  const item = flowFor(kind);
  const steps = flowSteps[kind];
  // A screen recording moves on by itself: set up, then the recorder, then the saved take.
  const shown = kind === "screen" ? (file || busy ? 2 : 0) : busy ? steps.length - 1 : step;
  const last = shown === steps.length - 1;
  const saveLabel =
    kind === "website"
      ? "Record website"
      : kind === "images"
        ? "Make video and save"
        : kind === "screen" && spoken
          ? "Save recording"
          : "Save to Vistralo";
  const progressLabel =
    progress?.phase === "hashing"
      ? "Checking the file"
      : progress?.phase === "verifying"
        ? "Verifying the file"
        : "Saving to Vistralo";
  const choosing = source === "screen" && !file && recording === "idle";
  // The name is asked for with the rest of the final step, or up front for a recording that saves itself on Stop.
  const askName = kind === "screen" ? recording === "idle" && !file : last;
  return (
    <form onSubmit={submit} className="sheet-form" noValidate>
      <SheetHeader
        titleId="create-title"
        descriptionId="create-description"
        icon={item.icon}
        title={item.label}
        description={stepIntro[kind][shown]}
        closeLabel="Close create project"
        onClose={() => void close()}
      />
      <div className="sheet-body">
        <FlowSteps steps={steps} current={shown} />
        {adapter.mode === "demo" && shown === 0 && (
          <p className="sheet-note">
            <Icon name="info" />
            <span>
              Demo workspace: projects and uploads stay in this browser, and website recording
              is simulated. Connect the server for real website capture and rendering.
            </span>
          </p>
        )}
        {askName && (
          <label className="field">
            <span>
              Project name <span className="flow-muted">(optional)</span>
            </span>
            <input
              value={name}
              maxLength={120}
              placeholder={
                kind === "website"
                  ? "Named after the website"
                  : kind === "screen"
                    ? "Named after what you record"
                    : kind === "images"
                      ? "Named after the images"
                      : "Named after the file"
              }
              onChange={(event) => setName(event.target.value)}
              disabled={busy || !!created}
            />
          </label>
        )}
        {children}
        {busy && (
          <div className="flow-stack flow-progress">
            <label htmlFor="create-progress">
              {building !== null
                ? `Turning images into a video: ${building}%`
                : progress
                  ? `${progressLabel}${progress.phase === "verifying" ? "…" : `: ${progress.percent}%`}`
                  : source === "web"
                    ? "Starting the website recording…"
                    : "Creating project…"}
            </label>
            <progress
              id="create-progress"
              max={100}
              {...(building !== null
                ? { value: building }
                : progress && progress.phase !== "verifying"
                  ? { value: progress.percent }
                  : {})}
            />
            {building !== null && (
              <p className="flow-caption flow-muted">
                Each image is held for a few seconds. Keep this tab open.
              </p>
            )}
            {source !== "web" &&
              (building !== null ||
                (progress && progress.phase !== "verifying")) && (
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => controller.current?.abort()}
                >
                  {building !== null ? "Stop" : "Pause upload"}
                </button>
              )}
          </div>
        )}
        {error && (
          <p className="flow-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="sheet-footer">
        {kind !== "screen" && shown > 0 ? (
          <button
            className="button"
            type="button"
            onClick={onBack}
            disabled={busy || !!created}
          >
            Back
          </button>
        ) : (
          <button
            className="button"
            type="button"
            onClick={() => void close()}
            disabled={busy || activeRecording}
          >
            Cancel
          </button>
        )}
        {choosing ? (
          <button
            key="choose"
            className="button button-primary"
            type="button"
            onClick={() => void chooseSource()}
            disabled={
              requestingCapture ||
              !screenSupported ||
              !storageChecked ||
              !adapter.capabilities.upload
            }
          >
            <Icon name="record" />
            {!storageChecked ? "Checking for a recording…" : requestingCapture ? "Choose a source…" : "Choose what to record"}
          </button>
        ) : kind !== "screen" && !last ? (
          // Locked until the step is complete. It stays focusable, so a keyboard or screen
          // reader user can reach it and is told what is missing instead of meeting a dead button.
          // Keyed apart from the save button: reusing one element would let the click that
          // moves to the last step also submit the form when the button turns into Save.
          <button
            key="next"
            className="button button-primary"
            type="button"
            aria-disabled={!canNext || undefined}
            onClick={() => (canNext ? onNext() : nextBlocked())}
          >
            Next
            <Icon name="arrowRight" />
          </button>
        ) : (
          <button
            key="save"
            className="button button-primary"
            type="submit"
            disabled={
              busy ||
              activeRecording ||
              (source !== "web" &&
                ((screenshots ? !shots.length : !file) ||
                  !adapter.capabilities.upload))
            }
          >
            {created && error ? "Try again" : saveLabel}
          </button>
        )}
      </footer>
    </form>
  );
}
