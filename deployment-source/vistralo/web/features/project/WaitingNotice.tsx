import React, { useEffect, useState } from "react";
import { Button } from "../../components/Controls";
import { Icon } from "../../components/Icon";
import type { WaitingSource } from "./useProjectDetail";

/**
 * A recording that has not reached Vistralo yet but is still kept in this browser: its upload
 * stopped when its page closed, the computer slept or the network dropped. It says so, and offers
 * to carry on with the upload (from where it stopped) or to download a copy first.
 */
export function WaitingNotice({
  waiting,
  busy,
  resume,
}: {
  waiting: WaitingSource;
  busy: boolean;
  resume: () => void;
}) {
  const { recording, match, elsewhere } = waiting;
  const [href, setHref] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(recording.file);
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [recording.file]);
  const made = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(recording.created),
  );
  return (
    <section className="stalled-notice" aria-labelledby="waiting-title">
      <span className="stalled-icon" aria-hidden="true">
        <Icon name="upload" />
      </span>
      <div className="stalled-copy">
        <h2 id="waiting-title">
          {elsewhere ? "Uploading in another tab" : "Your recording is still in this browser"}
        </h2>
        {elsewhere ? (
          <p>This recording is uploading in another tab. Leave that tab open until it finishes.</p>
        ) : match === "linked" ? (
          <p>
            Its upload stopped before it finished, so it is not saved to Vistralo yet. Resume the upload and it carries on
            from where it stopped. Keep this page open until it finishes.
          </p>
        ) : (
          <p>
            A recording made in this browser on {made} has not been saved to Vistralo yet. If it is this project's
            recording, upload it here. Keep this page open until it finishes.
          </p>
        )}
      </div>
      <div className="stalled-actions">
        {!elsewhere && (
          <Button variant="primary" icon="upload" disabled={busy} onClick={resume}>
            {match === "linked" ? "Resume upload" : "Upload it here"}
          </Button>
        )}
        {href && (
          <a className="button" href={href} download={recording.file.name}>
            <Icon name="download" />
            Download a copy
          </a>
        )}
      </div>
    </section>
  );
}
