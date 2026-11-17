# Vistralo privacy notice — DRAFT, NOT PUBLISHED

Effective date: `{{EFFECTIVE_DATE}}` · Operator: Dynamix LTD · Address: Mirpur 12, Eastern Housing, Road10, House 123, 2nd Floor, Dhaka 1216, Bangladesh · Website: https://vistralo.com · Privacy contact: contact@vistralo.com

This draft describes the Vistralo cloud app at https://app.vistralo.com, the website https://vistralo.com and the Vistralo extension for Chrome. It must be verified against the deployed service before publication. Dynamix LTD must identify when it acts as controller for account and operational data and when it processes customer recordings on a customer's instructions.

## What Vistralo handles

Vistralo stores each account's projects in Supabase: project names, recordings, uploaded videos and screenshots, posters, website briefs, scripts, generated audio and finished films. A processing worker on a server downloads a project's media to make the film and uploads the result. For website projects, the worker opens the public page in a headless browser and records the libraries, fonts and effects it finds. A capture can incidentally include people, voices, page text, account details or other personal information visible on screen. The customer chooses what to record and upload.

Sign-in uses Supabase Auth with an email address and password; the app keeps the sign-in session in browser storage. Provider API keys are sealed in the browser to the worker's public key and stored only as ciphertext. The marketing website sets no cookies and loads no analytics. Dynamix LTD must inventory the actual Vercel, Supabase and worker logs before stating what IP addresses, device details or diagnostics it retains.

## Purposes and legal basis — complete after operator review

| Purpose | Data | Legal basis for EEA/UK processing | Retention |
| --- | --- | --- | --- |
| Deliver recording, upload, editing, rendering and downloads | Customer content and project/job records | `{{BASIS_AND_CONTROLLER_PROCESSOR_ROLE}}` | `{{PROJECT_RETENTION}}` |
| Authenticate and protect the service | Account email, sign-in session, access attempts and operational logs | `{{BASIS}}` | `{{SESSION_AND_LOG_RETENTION}}` |
| Perform optional approved AI analysis | Selected frames and evidence sent to OpenAI | `{{BASIS}}` | `{{PROVIDER_RETENTION}}` |
| Perform optional approved voice generation | Approved script sent to OpenAI text-to-speech | `{{BASIS}}` | `{{PROVIDER_RETENTION}}` |
| Respond to support/privacy requests | Contact details and request records | `{{BASIS}}` | `{{SUPPORT_RETENTION}}` |
| Sell and manage paid plans (when switched on) | Account email and ID passed to Paddle at checkout; Paddle customer and subscription IDs, plan, status and billing dates stored by Vistralo. Card and billing details are held by Paddle, not Vistralo | `{{BASIS}}` | `{{BILLING_RECORD_RETENTION}}` |

Provider calls run only for the owner's own jobs, within the per-job cost cap set in provider settings. Provider request options alone are not a complete promise about provider retention or training. Confirm current provider terms before making a stronger statement. There is no marketing or analytics integration in the inspected application source.

## Vistralo for Chrome (browser extension)

The Vistralo Screen Recorder extension for Chrome records what the user chooses and hands the recording to their own Vistralo account. This section describes the extension as built in `extension/` (version 0.1.0); confirm it against the version published in the Chrome Web Store.

**What it handles.** Only what the user starts recording: the video of the tab, window or screen they choose, the tab's or system's sound if they allow it, their microphone and their camera if they turn them on. With each recording it keeps the title and address of the page it was started on, its length and whether it was interrupted. It also keeps the user's recording choices (what to record, which microphone and camera, countdown, bubble size) and the state of the recording under way.

**Where it is kept.** On the user's own computer, in the extension's storage in Chrome. A recording is written there every second so that a crash does not lose it, and it stays there until the user saves, downloads or discards it. Uninstalling the extension deletes that storage.

**When it leaves the browser.** Only when the user saves a recording to Vistralo (by "Save to Vistralo", or by stopping with "Open the recording in Vistralo when I stop" turned on). The extension then opens https://app.vistralo.com in the same browser and hands the recording to the web app there; the web app uploads it to the account the user is signed in to, and from then on it is handled like any other project, as described above. The address of the recorded page goes with it, without its query string or fragment. Once the web app has its copy, the extension deletes its own. "Download" saves a file to the user's computer and sends nothing.

**What it does not do.** The extension has no account or sign-in of its own and holds no password, session or token. It makes no network requests of its own, loads no code from outside its package, and contains no analytics, advertising or tracking. It does not read the contents of web pages, the user's browsing history or other tabs. It uses the microphone and camera only while recording, and only those the user chooses, after Chrome has asked the user's permission.

**Access to websites.** At install the extension can act only on a tab where the user clicks it in the toolbar, to record that tab and draw its recording controls on it. If the user ticks "Keep the controls on every site I visit while recording", Chrome asks for access to all sites, which is used only to draw those controls on other pages during a recording; unticking the option removes it. Its one script that runs without a click runs only on app.vistralo.com, to hand recordings to the web app.

**Retention and deletion.** In the browser: until the user saves, downloads or discards the recording, or removes the extension. In the user's Vistralo account: as for other projects, `{{PROJECT_RETENTION}}`.

**Chrome Web Store Limited Use.** The use of information received from the Vistralo Chrome extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements. In particular, data from the extension is used only to provide the user's recordings and walkthroughs; it is not sold, not used for advertising, not transferred to anyone except as needed to provide that service (the hosting and processing providers listed below), to comply with the law or to protect against abuse, and not used to determine creditworthiness or for lending. People at Vistralo do not view a user's recordings unless the user asks them to, it is needed for security or to comply with the law: `{{EXTENSION_ACCESS_POLICY}}`.

## Recipients and transfers

Hosting and backups: Vercel (app and website), Supabase (accounts, database, storage) and the worker's server host; countries and backup locations `{{HOST_AND_BACKUP_SUBPROCESSORS_COUNTRIES}}`. Optional OpenAI processing occurs only when approved: `{{PROVIDER_ENTITIES_LOCATIONS_TRANSFER_SAFEGUARDS}}`. Paddle (payments, as merchant of record) receives the account email and ID at checkout and is a controller of the payment data it collects: `{{PADDLE_ENTITY_ROLE_AND_TRANSFER_SAFEGUARDS}}`. Add any support, email, telemetry or marketing vendors actually used. If EEA/UK data moves abroad, state the applicable adequacy decision or transfer mechanism and how users can obtain it. List `{{EU_REPRESENTATIVE_IF_REQUIRED}}`, `{{UK_REPRESENTATIVE_IF_REQUIRED}}` and `{{DPO_IF_REQUIRED}}` where applicable.

## Retention, protection and requests

Define actual deletion periods for complete and incomplete uploads, recordings, outputs, session records, logs and backups. Explain whether deleting a project removes all replicas and when a backup ages out: `{{DELETION_AND_BACKUP_POLICY}}`. Storage access is limited by Supabase row-level security to each owner's own files; do not claim end-to-end encryption or independently restorable backups without verification.

People may have rights to access, correct, erase, restrict, object, port data or withdraw consent depending on their location and applicable legal basis. Send requests to `contact@vistralo.com`; describe verification, response time and any customer-controller routing at `{{RIGHTS_PROCESS}}`. EEA users can complain to a relevant data protection authority; UK users can complain to the ICO. Add California and other applicable US state rights, appeal/opt-out methods and notices after applicability and actual practices are confirmed. Do not imply a “Do Not Sell or Share” mechanism exists when it has not been implemented.

Contact: Dynamix LTD, Mirpur 12, Eastern Housing, Road10, House 123, 2nd Floor, Dhaka 1216, Bangladesh; email `contact@vistralo.com`. Material changes: `{{NOTICE_CHANGE_PROCESS}}`.
