import React, { useEffect, useRef, useState } from "react";
import type { Project, ProjectSource, WorkspaceAdapter } from "../contracts";
import { recoverRecording } from "./recording-store";
import { floatingControlsSupported } from "./capture";
import { RecordingTray } from "./RecordingControls";
import { startFlow, type CreateFlow } from "./create-flows";
import { confirmDialog } from "../components/Primitives";
import { CreateForm } from "./create/CreateForm";
import { RecordFlow } from "./create/RecordFlow";
import { RecordSetup } from "./create/RecordSetup";
import { ScreenshotsFlow } from "./create/ScreenshotsFlow";
import { SiteUrlField } from "./create/SiteUrlField";
import { formatBytes, publicWebsite, websiteProblem } from "./flow-utils";
import { UploadVideoFlow } from "./create/UploadVideoFlow";
import { WebsiteAddress, WebsiteOptions } from "./create/WebsiteFlow";
import { AiLaterNote, SaveSummary } from "./create/FlowSteps";
import { useFloatingTray, useRecordingMeters, useRecordingSignal } from "./create/recorder-effects";
import { useRecorder } from "./create/useRecorder";
import { useSaveProject } from "./create/useSaveProject";
import "./features.css";

interface Props {
  source: ProjectSource;
  flow?: CreateFlow;
  adapter: WorkspaceAdapter;
  onCreated: (project: Project) => void;
  onClose: () => void;
  notify: (message: string, error?: boolean) => void;
  /** Opened on a recording handed over by the Chrome extension, and the page it was made on. */
  imported?: { url: string } | null;
  /** Opened from the Record button: go straight to the browser's picker. */
  quick?: boolean;
}

export function CreateProject({
  source,
  flow,
  adapter,
  onCreated,
  onClose,
  notify,
  imported = null,
  quick = false,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(true);
  const [name, setName] = useState(""),
    [url, setUrl] = useState(imported?.url ?? ""),
    [file, setFile] = useState<File | null>(null);
  const [mobile, setMobile] = useState(true);
  // From the Record button the sheet stays out of sight while the browser's own picker is up, so
  // the two never sit on top of each other. It appears once there is something to show: the area
  // to set up, the recording tray, a left-over recording, or an error.
  const [hidden, setHidden] = useState(quick && source === "screen");
  const startHidden = useRef(hidden);
  // Each flow is a few steps; Next unlocks once the step has what it asks for.
  const [step, setStep] = useState(0),
    [touched, setTouched] = useState(false);
  const [error, setError] = useState(""),
    // Set when the dialog opens onto a recording left over from an earlier visit.
    [leftOver, setLeftOver] = useState<Date | null>(null),
    [localUrl, setLocalUrl] = useState("");
  const [storageChecked, setStorageChecked] = useState(source !== "screen");
  const kind = flow
    ? startFlow(flow)
    : source === "web"
      ? "website"
      : source === "screen"
        ? "screen"
        : "video";
  const screenshots = kind === "images";
  const [shots, setShots] = useState<File[]>([]);
  // Whether this workspace can add an AI walkthrough once the project is saved.
  const offersAi = adapter.mode === "cloud" && adapter.capabilities.providers;
  const rec = useRecorder({ flow, url, mounted, setError, setFile, onDiscard: onClose });
  const {
    recorder,
    spokenTake,
    autoSave,
    spoken,
    setSpoken,
    recording,
    setRecording,
    display,
    floating,
    live,
    recoverySaved,
    setRecoverySaved,
    activeRecording,
    screenSupported,
    trayProps,
    closeFloating,
    popOutControls,
    stopCaptureTracks,
    chooseSource,
    sharedTitle,
  } = rec;
  const { controller, created, busy, progress, building, save } = useSaveProject({
    source,
    flow,
    screenshots,
    adapter,
    name,
    url,
    sharedTitle,
    file,
    shots,
    mobile,
    spoken,
    activeRecording,
    mounted,
    setError,
    notify,
    onCreated,
  });
  const siteUrlField = offersAi && (
    <SiteUrlField url={url} setUrl={setUrl} disabled={busy || !!created.current} />
  );
  const canNext =
    kind === "website"
      ? step > 0 || (!!url.trim() && !websiteProblem(url))
      : kind === "images"
        ? shots.length > 0
        : !!file;
  function nextBlocked() {
    if (kind === "website") setTouched(true);
    else setError(kind === "images" ? "Choose at least one image to go on." : "Choose a video to go on.");
    dialog.current
      ?.querySelector<HTMLInputElement>(".sheet-body input:not([type=checkbox])")
      ?.focus();
  }
  function goNext() {
    setError("");
    setStep((current) => current + 1);
  }
  function goBack() {
    setError("");
    setStep((current) => Math.max(0, current - 1));
  }
  // A new step puts the cursor in its first field, or on its heading when it has none.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const field = dialog.current?.querySelector<HTMLElement>(
      ".sheet-body input:not([type=checkbox]):not([type=file]):not(:disabled)",
    );
    if (field) field.focus();
    else {
      const title = dialog.current?.querySelector<HTMLElement>("#create-title");
      title?.setAttribute("tabindex", "-1");
      title?.focus();
    }
  }, [step]);

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    if (!startHidden.current) dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLInputElement>("input:not([type=checkbox])")
      ?.focus();
    if (source === "screen")
      recoverRecording()
        .then((saved) => {
          if (saved && mounted.current) {
            setFile(saved.file);
            setSpoken(saved.microphone);
            spokenTake.current = saved.microphone;
            setRecording("staged");
            setRecoverySaved(true);
            // A recording just handed over by the extension is not one left over from an earlier visit.
            if (!imported) setLeftOver(new Date(saved.file.lastModified));
          }
          return !!saved;
        })
        .catch(() => false)
        .then(async (leftOverFound) => {
          if (!mounted.current) return;
          setStorageChecked(true);
          // The click on Record still counts as the gesture the browser's picker needs, so ask
          // now instead of making the user press a second button. Opened from the menu, the first
          // step's options (your voice, part of the screen) come first.
          if (quick && !leftOverFound && screenSupported && adapter.capabilities.upload) {
            const outcome = await chooseSource(true);
            if (!mounted.current) return;
            // Cancelling the browser's picker means "never mind": nothing is left behind.
            if (outcome === "cancelled") {
              onClose();
              return;
            }
          }
          setHidden(false);
        });
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (recorder.current && recorder.current.state !== "inactive")
        recorder.current.stop();
      stopCaptureTracks();
      closeFloating();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!file || source !== "screen") {
      setLocalUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, source]);

  useRecordingMeters(rec);

  // The sheet held back for the browser's picker comes into view as a tray while recording,
  // or as the usual modal sheet otherwise.
  useEffect(() => {
    const element = dialog.current;
    if (hidden || !element || element.open) return;
    if (live) element.show();
    else element.showModal();
  }, [hidden]);

  // Recording must not block the page, so the dialog becomes a non-modal tray.
  useEffect(() => {
    const element = dialog.current;
    if (!element?.open) return;
    const modal = element.matches(":modal");
    if (live && modal) {
      element.close();
      element.show();
    } else if (!live && !modal) {
      element.close();
      element.showModal();
    }
  }, [live]);

  useFloatingTray(rec);
  useRecordingSignal(rec);

  useEffect(() => {
    if (recording !== "staged" || !file || !autoSave.current) return;
    autoSave.current = false;
    void save();
  }, [recording, file]);

  useEffect(() => {
    if (
      !activeRecording &&
      !busy &&
      !(source === "screen" && file && !recoverySaved)
    )
      return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [activeRecording, busy, source, file, recoverySaved]);

  async function close() {
    // Escape during the count-in stops the take before it starts.
    if (rec.counting) {
      rec.cancelCountdown();
      return;
    }
    if (activeRecording) {
      setError(
        "Stop the recording before closing. Your recording will be saved for recovery.",
      );
      return;
    }
    if (busy) {
      setError(
        progress?.phase === "verifying"
          ? "Wait for the import to finish before closing."
          : source === "web"
            ? "Wait for the website recording to start before closing."
            : "Pause the upload before closing.",
      );
      return;
    }
    if (
      source === "screen" &&
      file &&
      !recoverySaved &&
      !(await confirmDialog({
        title: "Discard this recording?",
        message:
          "A recovery copy could not be stored in this browser. Download your recording first if you want to keep it.",
        confirmLabel: "Discard and close",
        cancelLabel: "Keep recording",
        tone: "danger",
      }))
    )
      return;
    onClose();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // Enter on an early step is Next, and is held back the same way until the step is complete.
    const last = kind === "screen" || step === (kind === "website" ? 2 : 1);
    if (!last) {
      if (canNext) goNext();
      else nextBlocked();
      return;
    }
    void save();
  }

  return (
    <dialog
      ref={dialog}
      className={
        live
          ? "flow-dialog is-tray"
          : `flow-dialog sheet ${recording === "ready" ? "sheet-wide" : "sheet-default"}`
      }
      {...(live
        ? { "aria-label": "Recording controls" }
        : {
            "aria-labelledby": "create-title",
            "aria-describedby": "create-description",
          })}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      {live && !floating ? (
        <div className="rec-tray-host">
          <RecordingTray
            {...trayProps}
            canPopOut={floatingControlsSupported && !floating}
            onPopOut={popOutControls}
          />
          {error && (
            <p className="rec-tray-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : live ? (
        error ? (
          <p className="rec-tray-error" role="alert">
            {error}
          </p>
        ) : null
      ) : recording === "ready" && display ? (
        <RecordSetup recorder={rec} display={display} error={error} close={close} />
      ) : (
        <CreateForm
          source={source}
          flow={flow}
          adapter={adapter}
          recorder={rec}
          name={name}
          setName={setName}
          file={file}
          shots={shots}
          screenshots={screenshots}
          storageChecked={storageChecked}
          busy={busy}
          progress={progress}
          building={building}
          controller={controller}
          created={created.current}
          error={error}
          step={step}
          canNext={canNext}
          nextBlocked={nextBlocked}
          onNext={goNext}
          onBack={goBack}
          submit={submit}
          close={close}
        >
          {kind === "website" ? (
            step === 0 ? (
              <WebsiteAddress
                url={url}
                setUrl={setUrl}
                touched={touched}
                setTouched={setTouched}
                busy={busy}
              />
            ) : step === 1 ? (
              <WebsiteOptions url={url} mobile={mobile} setMobile={setMobile} busy={busy} />
            ) : (
              <>
                <SaveSummary
                  rows={[
                    ["Website", siteAddress(url)],
                    ["Views", mobile ? "Desktop and phone" : "Desktop"],
                  ]}
                />
                <AiLaterNote offered={offersAi} />
              </>
            )
          ) : kind === "images" ? (
            step === 0 ? (
              <ScreenshotsFlow
                shots={shots}
                setShots={setShots}
                busy={busy}
                adapter={adapter}
                setError={setError}
              />
            ) : (
              <>
                <SaveSummary
                  rows={[
                    ["Images", `${shots.length} ${shots.length === 1 ? "image" : "images"}, in file-name order`],
                    ["Size", formatBytes(shots.reduce((sum, shot) => sum + shot.size, 0))],
                  ]}
                />
                <AiLaterNote offered={offersAi} />
              </>
            )
          ) : kind === "video" ? (
            step === 0 ? (
              <UploadVideoFlow
                file={file}
                setFile={setFile}
                busy={busy}
                adapter={adapter}
                setError={setError}
              />
            ) : (
              <>
                <SaveSummary
                  rows={[
                    ["Video", file?.name || ""],
                    ["Size", file ? formatBytes(file.size) : ""],
                  ]}
                />
                <AiLaterNote offered={offersAi} />
              </>
            )
          ) : (
            <RecordFlow
              recorder={rec}
              siteUrlField={siteUrlField}
              file={file}
              setFile={setFile}
              localUrl={localUrl}
              leftOver={leftOver}
              setLeftOver={setLeftOver}
              busy={busy}
              setError={setError}
            />
          )}
        </CreateForm>
      )}
    </dialog>
  );
}

/** "example.com/pricing": the address as people read it. */
function siteAddress(url: string) {
  try {
    const parsed = new URL(publicWebsite(url));
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}
