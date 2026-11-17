import React from "react";
import { Field } from "../../components/Controls";
import { Icon } from "../../components/Icon";
import { SheetToggle } from "../../components/Primitives";
import { publicWebsite, websiteProblem } from "../flow-utils";

/**
 * Step one of Record a website: the address. Next stays locked until it is a public http(s)
 * address. A problem is named once the person leaves the field or asks for the next step, not
 * on the first keystroke.
 */
export function WebsiteAddress({
  url,
  setUrl,
  touched,
  setTouched,
  busy,
}: {
  url: string;
  setUrl: (url: string) => void;
  touched: boolean;
  setTouched: (touched: boolean) => void;
  busy: boolean;
}) {
  const problem = websiteProblem(url);
  let ready = "";
  if (url.trim() && !problem) ready = new URL(publicWebsite(url)).host;
  return (
    <Field
      label="Website address"
      error={touched && url.trim() ? problem : touched && !url.trim() ? "Type the address of the website to record, such as example.com." : ""}
      hint={
        ready ? (
          <span className="field-ready">
            <Icon name="checkCircle" size={14} />
            Ready to record {ready}
          </span>
        ) : (
          "A public page, such as example.com. Sign-in screens and sites that block automated visits may not record."
        )
      }
    >
      <input
        id="website-address"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="url"
        spellCheck={false}
        value={url}
        placeholder="example.com"
        onChange={(event) => setUrl(event.target.value)}
        onBlur={() => setTouched(true)}
        disabled={busy}
      />
    </Field>
  );
}

/** Step two: how the site is recorded. */
export function WebsiteOptions({
  url,
  mobile,
  setMobile,
  busy,
}: {
  url: string;
  mobile: boolean;
  setMobile: (mobile: boolean) => void;
  busy: boolean;
}) {
  let host = url;
  try {
    host = new URL(publicWebsite(url)).host;
  } catch {
    /* Step one only lets a valid address through. */
  }
  return (
    <>
      <p className="flow-caption flow-muted">
        Vistralo opens {host} in its own browser, scrolls every section and records it, then
        writes a visual brief from what it saw. The desktop view (1440 × 900) is always recorded.
      </p>
      <div className="sheet-group">
        <SheetToggle
          label="Phone view too"
          hint={
            mobile
              ? "Also records the site at 390 × 844, so you can see how it adapts."
              : "Only the desktop view is recorded."
          }
          checked={mobile}
          onChange={setMobile}
          disabled={busy}
        />
      </div>
    </>
  );
}
