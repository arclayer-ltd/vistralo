import { confirmDialog } from "../../components/Primitives";
import { useEffect, useRef, useState } from "react";
import type {
  Project,
  ProjectDetail as ProjectInfo,
  UploadProgress,
  WorkspaceAdapter,
} from "../../contracts";
import { buildClipPlan, errorMessage, validateVideo } from "../flow-utils";
import { downloadAgentKit } from "../../agent-kit";
import { clip } from "./clips";
import type { Clip } from "./clips";
import { clearRecordingIf, recordingFor, recoverRecording, type WaitingRecording } from "../recording-store";
import { uploadRunning } from "../../upload-lock";

/** A recording kept in this browser that is (or may be) this project's unsaved source. */
export interface WaitingSource {
  recording: WaitingRecording;
  /** "linked": saving into this project started here; "likely": an older version kept it with no project named. */
  match: "linked" | "likely";
  /** Another tab is uploading it now. */
  elsewhere: boolean;
}

export type ProjectAction = (
  label: string,
  run: () => Promise<unknown>,
  message: string | (() => string),
) => Promise<void>;

export function useProjectDetail(
  initial: Project,
  adapter: WorkspaceAdapter,
  onBack: () => void,
  onChanged: (project?: Project) => void,
  notify: (message: string, error?: boolean) => void,
) {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [kitStage, setKitStage] = useState("");
  const [brief, setBrief] = useState(""),
    [briefDirty, setBriefDirty] = useState(false),
    [briefMode, setBriefMode] = useState<"edit" | "preview">("preview");
  const [script, setScript] = useState(""),
    [scriptDirty, setScriptDirty] = useState(false),
    [draftDirty, setDraftDirty] = useState(false);
  const [source, setSource] = useState(""),
    [duration, setDuration] = useState<number | null>(null),
    [durationError, setDurationError] = useState("");
  const [clips, setClips] = useState<Clip[]>([clip()]),
    [planDirty, setPlanDirty] = useState(false),
    [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null),
    [waiting, setWaiting] = useState<WaitingSource | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState(initial.url || ""),
    [mediaError, setMediaError] = useState("");
  const dirtyBrief = useRef(false),
    dirtyScript = useRef(false),
    dirtyPlan = useRef(false),
    uploadController = useRef<AbortController | null>(null),
    resumed = useRef(false),
    polling = useRef(false),
    live = useRef(false),
    version = useRef(0);
  const briefFile = useRef("");
  const project = info?.project ?? initial,
    files = info?.files ?? [];
  const active = ["processing", "queued"].includes(project.status),
    processing = active || !!busy;

  async function refresh(initialLoad = false, quiet = false) {
    const requestVersion = ++version.current;
    if (initialLoad) setLoading(true);
    try {
      const next = await adapter.project(initial.id);
      if (requestVersion !== version.current) return;
      setInfo(next);
      live.current = !!next.progress?.previewUrl;
      const plan = next.project.data.editPlan;
      if (!dirtyPlan.current && plan?.source) {
        setSource(plan.source);
        setClips(
          plan.clips.map((part: any) =>
            clip(String(part.start), String(part.end)),
          ),
        );
      } else if (!dirtyPlan.current)
        setSource(
          next.project.video || next.project.data.video || "",
        );
      if (!dirtyScript.current)
        setScript(String(next.project.data.script || ""));
      if (!dirtyBrief.current) {
        const file = next.files.find((item) =>
          /(?:visual|implementation)-brief\.md$/i.test(item.file),
        )?.file;
        briefFile.current = file || "";
        if (typeof next.brief === "string") setBrief(next.brief);
        else if (file) {
          const text = await adapter.readText(initial.id, file);
          if (requestVersion === version.current && !dirtyBrief.current)
            setBrief(text);
        }
      }
      setError("");
    } catch (failure) {
      if (requestVersion !== version.current) return;
      // A dropped background poll is not a broken project. Keep the last good
      // view on screen and let the caller decide how long to back off.
      if (quiet) throw failure;
      setError(errorMessage(failure));
    } finally {
      if (requestVersion === version.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    return () => {
      ++version.current;
      uploadController.current?.abort();
    };
  }, [initial.id, adapter]);
  useEffect(() => {
    if (info && initial.updated !== info.project.updated) void refresh();
  }, [initial.updated]);
  // A recording whose upload stopped (its page closed, the computer slept) is still kept in this
  // browser. Find it, and carry on with the upload when saving into this project started here.
  useEffect(() => {
    if (adapter.mode !== "cloud" || !adapter.capabilities.upload || uploadProgress || loading) return;
    let stop = false;
    void (async () => {
      const recording = await recoverRecording().catch(() => null);
      const match = recordingFor(recording, project);
      if (stop) return;
      if (!recording || !match) {
        setWaiting(null);
        return;
      }
      const elsewhere = await uploadRunning(project.id);
      if (stop) return;
      setWaiting({ recording, match, elsewhere });
      if (match === "linked" && !elsewhere && !resumed.current) {
        resumed.current = true;
        void uploadVideo(recording.file, recording);
      }
    })();
    return () => {
      stop = true;
    };
  }, [project.id, project.status, project.video, project.trashed, adapter, !!uploadProgress, loading]);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer = 0;
    let misses = 0;
    const tick = async () => {
      if (!stop && document.visibilityState !== "hidden" && !polling.current) {
        polling.current = true;
        try {
          await refresh(false, true);
          misses = 0;
        } catch {
          misses = Math.min(misses + 1, 4);
        } finally {
          polling.current = false;
        }
      }
      if (stop) return;
      // Match the capture's frame rate while it is streaming, idle back when it
      // is not, and back off hard on failure so a blip cannot become a stampede.
      const base = live.current ? 1500 : 4000;
      timer = window.setTimeout(
        tick,
        misses ? Math.min(20000, base * 2 ** misses) : base,
      );
    };
    const wake = () => {
      if (stop || document.visibilityState === "hidden") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, 0);
    };
    timer = window.setTimeout(tick, 0);
    document.addEventListener("visibilitychange", wake);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [active, initial.id, adapter]);
  useEffect(() => {
    if (!source) {
      setDuration(null);
      return;
    }
    let cancelled = false;
    setDuration(null);
    setDurationError("");
    adapter
      .rpc("mediaInfo", { id: project.id, file: source })
      .then((result) => {
        const measured = Number(
          result.duration ??
            result.format?.duration ??
            result.media?.format?.duration,
        );
        if (!cancelled) {
          if (Number.isFinite(measured) && measured > 0) {
            setDuration(measured);
            setClips((current) =>
              current.length === 1 && !current[0].end
                ? [{ ...current[0], end: String(measured) }]
                : current,
            );
          } else
            setDurationError(
              "This file has no finite duration. Choose another source before creating a trim plan.",
            );
        }
      })
      .catch((failure) => {
        if (!cancelled) setDurationError(errorMessage(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [source, project.id, adapter]);
  useEffect(() => {
    if (!briefDirty && !planDirty && !scriptDirty && !draftDirty && !uploadProgress) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [briefDirty, planDirty, scriptDirty, draftDirty, uploadProgress]);

  async function action(
    label: string,
    run: () => Promise<unknown>,
    message: string | (() => string),
  ) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await run();
      await refresh();
      onChanged();
      notify(typeof message === "function" ? message() : message);
    } catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      notify(message, true);
    } finally {
      setBusy("");
    }
  }

  async function back() {
    if (uploadProgress) {
      setError("Pause the upload before leaving this project.");
      return;
    }
    if (
      (briefDirty || planDirty || scriptDirty || draftDirty) &&
      !(await confirmDialog({
        title: "Discard unsaved edits?",
        message: "You have edits in this project that are not saved yet.",
        confirmLabel: "Discard and leave",
        cancelLabel: "Keep editing",
        tone: "danger",
      }))
    )
      return;
    onBack();
  }

  function updateClips(next: Clip[]) {
    setClips(next);
    dirtyPlan.current = true;
    setPlanDirty(true);
  }
  async function savePlan(render = false) {
    await action(
      render ? "Rendering" : "Saving plan",
      async () => {
        const next = buildClipPlan(source, duration, clips);
        await adapter.rpc("plan", { id: project.id, plan: next });
        dirtyPlan.current = false;
        setPlanDirty(false);
        if (render)
          await adapter.rpc("process", { id: project.id, action: "render" });
      },
      render
        ? "Rendering started. The source recording is preserved."
        : "Trim plan saved.",
    );
  }

  /** Uploads a chosen file, or the recording kept in this browser (which is then cleared). */
  async function uploadVideo(file: File, kept?: WaitingRecording) {
    await action(
      "Uploading",
      async () => {
        validateVideo(file, adapter.mode === "cloud");
        uploadController.current = new AbortController();
        try {
          await adapter.upload(project.id, file, {
            signal: uploadController.current.signal,
            onProgress: setUploadProgress,
            ...(kept ? { voice: kept.microphone ? ("microphone" as const) : ("original" as const) } : {}),
          });
          if (kept) {
            await clearRecordingIf(kept.created).catch(() => {});
            setWaiting(null);
          }
          dirtyPlan.current = false;
          setPlanDirty(false);
        } finally {
          setUploadProgress(null);
        }
      },
      () =>
        adapter.mode === "demo"
          ? "Video saved in this browser demo."
          : "Video uploaded. The worker checks its checksum before processing it.",
    );
  }

  async function downloadKit() {
    if (kitStage) return;
    setKitStage("Preparing");
    try {
      await downloadAgentKit(adapter, project, setKitStage, project.type === "brief" ? brief : "");
      notify("Build kit downloaded: prompt, video, captions and screens.");
    } catch (failure) {
      notify(errorMessage(failure), true);
    } finally {
      setKitStage("");
    }
  }

  return {
    info,
    project,
    files,
    active,
    processing,
    loading,
    error,
    busy,
    kitStage,
    brief,
    setBrief,
    briefDirty,
    setBriefDirty,
    briefMode,
    setBriefMode,
    script,
    setScript,
    scriptDirty,
    setScriptDirty,
    setDraftDirty,
    source,
    setSource,
    duration,
    durationError,
    clips,
    setPlanDirty,
    uploadProgress,
    waiting,
    websiteUrl,
    setWebsiteUrl,
    mediaError,
    dirtyBrief,
    dirtyScript,
    dirtyPlan,
    uploadController,
    refresh,
    action,
    back,
    updateClips,
    savePlan,
    uploadVideo,
    downloadKit,
  };
}
