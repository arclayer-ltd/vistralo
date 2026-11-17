# Chrome Web Store listing: Vistralo Screen Recorder

Everything to paste into the Chrome Web Store developer dashboard, field by field. Written 17 November 2026 against extension version 0.1.0 and Google's published rules on that date (sources at the end). `store/SUBMIT.md` says in which order to fill it in.

`{{...}}` would mark a fact only the owner can supply; none are left. The owner's remaining choices (the trader declaration) are in `SUBMIT.md`.

## From the manifest (not editable in the dashboard)

The store takes these from `extension/manifest.json`. To change them, edit the manifest, raise `version`, rebuild and upload again.

| Field | Value | Limit |
| --- | --- | --- |
| Name | Vistralo Screen Recorder | 75 characters |
| Summary | Record a tab, window, screen or camera with your microphone, then turn it into a narrated walkthrough in your Vistralo account. | 132 characters (this is 127) |
| Icon | `icons/icon-128.png` (96 px artwork, 16 px transparent padding) | 128×128 |
| Version | 0.1.0 | Each upload must be higher than the last |

## Store listing tab

**Description** (plain text; paste as is):

```
Vistralo records what is on your screen and turns it into a narrated walkthrough.

Record this tab with its sound, a window, your whole screen, or just your camera. Add your microphone, and show your camera in a round bubble on the page. When you stop, the recording opens in Vistralo, where you choose an AI-narrated walkthrough that pauses on each screen and explains it, or keep your own voice.

What you can do
• Record a tab with its sound, a window, a screen or the camera alone
• Add your microphone, see its level, and mute it while recording
• Show your camera in a bubble on the page, in three sizes
• Count down from 3 before the recording starts
• Pause, resume, start over or discard from the toolbar popup, keyboard shortcuts (Alt+Shift+V to start and stop, Alt+Shift+K to pause) or a bar on the page. When you record a tab, the bar stays out of the video and shows only while you are paused
• Keep going if Chrome or your computer crashes: the recording is written to your browser every second and can be recovered
• Download a recording as a WebM file instead of saving it

Where your recordings go
Recordings stay in your browser until you save them. Saving opens Vistralo (app.vistralo.com) in the same browser, and the recording is uploaded to the Vistralo account you are signed in to. The extension has no account of its own, holds no password or token, sends nothing anywhere else, and has no analytics or ads.

You need a Vistralo account to turn a recording into a walkthrough. Recording, recovery and download work without one.

Permissions
Vistralo only records after you click it in the toolbar and press Start. It asks to draw its controls on every site only if you tick that option; otherwise they stay on the page you started on.

Privacy policy: https://vistralo.com/privacy
Help: contact@vistralo.com
```

**Category:** Productivity → Tools. (Workflow & Planning is the other reasonable choice; Tools is where screen recorders are listed.)

**Language:** English.

**Graphic assets** (all in `store/images/`, made by `npm run store:images`; see `images/README.md`):

| Dashboard field | File | Size |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128×128 |
| Screenshots (upload in this order) | `screenshot-1-choose.png`, `screenshot-2-recording.png`, `screenshot-3-open-in-vistralo.png`, `screenshot-4-recordings.png`, `screenshot-5-setup.png` | 1280×800 each; the store allows at most five |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400×560 |
| Promo video (optional) | none | YouTube link |

**Additional fields:**

| Field | Value |
| --- | --- |
| Official URL | https://vistralo.com (only selectable after the owner verifies the domain in Google Search Console) |
| Homepage URL | https://vistralo.com |
| Support URL | `mailto:contact@vistralo.com`. If the dashboard refuses a mailto link, leave it blank; the email is in the description. |
| Mature content | No |

## Privacy practices tab

**Single purpose:**

```
Record the user's browser tab, window, screen or camera, with their microphone if they choose, and hand the finished recording to the user's own Vistralo account, where it becomes a narrated walkthrough.
```

**Permission justifications** (one box each):

| Permission | Justification |
| --- | --- |
| `tabCapture` | Records the tab the user is on, with its sound, when they choose "This tab" and press Start after clicking Vistralo in the toolbar. Used for nothing else. |
| `offscreen` | The recording runs in an offscreen document (reasons USER_MEDIA and DISPLAY_MEDIA) so it keeps going after the popup closes and while the user moves between pages. A Manifest V3 service worker cannot hold a media stream. |
| `activeTab` | Gives access only to the tab where the user clicked Vistralo: to capture it, and to draw the recording bar and camera bubble on that page. Vistralo gets no access to other tabs. |
| `scripting` | Injects the extension's own recording bar (`controls.js`, packaged with the extension) into the tab granted by activeTab, and again after that tab navigates during the recording. No code from outside the package is run. |
| `storage` | Keeps the user's choices (what to record, microphone, camera, countdown, bubble size) in storage.local, and the state of the recording under way in storage.session, so the popup, the page bar and the keyboard shortcuts show the same state. |
| `unlimitedStorage` | Recordings are written to the browser's storage (IndexedDB) every second so that a crash or a closed tab loses nothing. A recording takes about 45 MB a minute, more than the default quota allows, and must not be cleared by the browser before the user saves, downloads or discards it. |
| Host permissions (optional `http://*/*`, `https://*/*`) | Not requested at install. Asked only if the user ticks "Keep the controls on every site I visit while recording" in the popup, so the recording bar can follow them to other sites. It is used only to draw that bar; page contents are not read. Unticking removes it. |

If the dashboard asks about the content script or web-accessible resources: the only content script runs on `https://app.vistralo.com/*`, Vistralo's own web app, to hand a finished recording to it. The camera bubble and microphone meter are extension pages shown in frames inside the recording bar.

**Remote code:** No, I am not using remote code. (All JavaScript is in the package; the extension pages' CSP is `script-src 'self'`; the release check in `scripts/extension-package.cjs` refuses `eval`, `new Function` and scripts from other hosts.)

**Data usage.** What the extension handles, and what to tick:

| Category | Tick? | Why |
| --- | --- | --- |
| Personally identifiable information | Yes | When the user turns them on, the recording contains their voice (microphone) and face (camera). |
| Health information | No | Not collected. |
| Financial and payment information | No | Not collected. |
| Authentication information | No | The extension has no sign-in and holds no password or token. |
| Personal communications | No | Not collected. |
| Location | No | Not collected. |
| Web history | Yes | The address of the recorded page (without its query or fragment) is passed to the user's Vistralo account with the recording. No other browsing history is read. |
| User activity | No | Clicks, keystrokes and mouse positions are not logged. The video shows what happened on screen, which is covered by "Website content". |
| Website content | Yes | The recording is a video of the tab, window or screen the user chose, with its sound. |

A screen recording can show anything the user puts on screen. The extension does not look inside recordings; they go only to the user's own account when the user saves them.

**Certifications** (tick all three; each is true of this extension):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://vistralo.com/privacy`. It is built from `docs/legal/PRIVACY.md` and includes the extension section and the Limited Use statement. Open it in a private window before submitting to check it loads without signing in.

## Distribution tab

| Field | Recommendation |
| --- | --- |
| Visibility | **Public**, the owner's choice (17 November 2026). Public sign-up on app.vistralo.com must be open before this goes live, or people who install the extension have no way to make an account and save. |
| Regions | All regions, unless the owner's legal review says otherwise. |
| Pricing | Free. The extension sells nothing; plans, if any, are in the web app. |

## Sources

- Listing images: https://developer.chrome.com/docs/webstore/images
- Listing fields: https://developer.chrome.com/docs/webstore/cws-dashboard-listing and https://developer.chrome.com/docs/webstore/best-listing
- Privacy tab: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- User data FAQ and Limited Use: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq and https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Prominent disclosure: https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
- Program policies (remote code, keyword spam, minimal permissions): https://developer.chrome.com/docs/webstore/program-policies/policies
- Permission warnings: https://developer.chrome.com/docs/extensions/reference/permissions-list
- Review process: https://developer.chrome.com/docs/webstore/review-process
- Distribution: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution

Not confirmed on an official page on 17 November 2026: the exact wording of the data-usage checkboxes and certifications (the wording above is how the dashboard has shown them), and the registration fee amount.
