# Submitting Vistralo Screen Recorder to the Chrome Web Store

The owner's checklist, in order. Nothing here has been done for you: no developer account exists, nothing has been paid, uploaded, submitted or published. Field-by-field text for the dashboard is in `LISTING.md`.

## 1. Before you start

These must be true first, or the extension will be listed but fail when people use it.

- [ ] **The web app's import route is live.** "Save to Vistralo" opens `https://app.vistralo.com/#import/<id>`, which ships with PR arclayer-ltd/vistralo#25. Merge it to `main` (which deploys app.vistralo.com) and check the route in production before submitting.
- [ ] **The privacy policy is published.** Fill the placeholders in `docs/legal/PRIVACY-DRAFT.md` (including its "Vistralo for Chrome" section and Limited Use statement), get it reviewed, and publish it at a public URL on vistralo.com. Write that URL into `{{PRIVACY_POLICY_URL}}` below.
- [ ] **Public sign-up is open.** The listing is Public (decided 17 November 2026), so anyone can install it; without open sign-up on app.vistralo.com they could not make an account to save into.
- [ ] **Someone has recorded with a release build in normal Chrome.** The automated journey uses Chrome for Testing; a real camera, microphone and Chrome's "Choose what to share" dialog need a person. See "Load the release build" below.

## 2. Things only you can supply

| Placeholder | Where it goes | What it is |
| --- | --- | --- |
| `{{PRIVACY_POLICY_URL}}` | `LISTING.md` description and privacy tab | The public URL of the published privacy policy |
| Support URL | `LISTING.md` additional fields | Decided: `mailto:hello@arclayer.co` |
| Visibility | Distribution tab | Decided: Public |
| `{{CWS_PUBLISHER_NAME}}` | Developer account | The publisher name shown on the listing (for example "Dynamix LTD" or "Vistralo") |
| `{{CWS_TRADER_STATUS}}` | Developer account | Trader or non-trader (EU consumer law). A company selling a service is normally a trader; traders' address, email and phone are shown publicly once verified |
| Contact email | Developer account | Decided: hello@arclayer.co (verify it in the dashboard) |
| Access to recordings | `docs/legal/PRIVACY-DRAFT.md` | Decided: nobody at Vistralo watches customers' recordings; filled in |
| The privacy draft's existing fields | `docs/legal/PRIVACY-DRAFT.md` | `{{EFFECTIVE_DATE}}`, `{{PROJECT_RETENTION}}` and the rest listed in `docs/legal/README.md` |

Also confirm the facts the drafts mark as unconfirmed: company name Dynamix LTD, its Dhaka address, and contact@vistralo.com.

## 3. Developer account (once)

1. Sign in at https://chrome.google.com/webstore/devconsole with the Google account that will own the listing. Use a company account, not a personal one: an account can create only one publisher in its lifetime, and others can be added to it later as members.
2. Turn on 2-Step Verification for that Google account. Google requires it before you can publish or update.
3. Accept the developer agreement and pay the one-time registration fee (US$5 when last announced by Google; the dashboard shows the current amount).
4. In **Account**, set the publisher name (`{{CWS_PUBLISHER_NAME}}`), add and **verify** the contact email (hello@arclayer.co; Google sends a link), and make the trader declaration (`{{CWS_TRADER_STATUS}}`). A trader also gives a phone number and address, which are verified and shown on the listing.
5. Optional but useful: verify vistralo.com in Google Search Console with the same Google account, so it can be chosen as the listing's Official URL.

## 4. Build the package

From `deployment-source/vistralo`, on a clean checkout of the commit you want to ship:

```sh
npm ci
VISTRALO_EXTENSION_TARGET=release npm run build:extension
npm test
```

The upload is `extension-dist/vistralo-extension-<version>-release.zip`. The build checks the zip before writing it and fails, removing the zip, if anything is wrong (a manifest key, a source map, a local or demo address, `eval`, an unexpected permission, a missing icon; the full list is `releaseProblems` in `scripts/extension-package.cjs`). `tests/extension-release.test.cjs` proves the check catches each of those.

Never upload `extension-dist/*-dev.zip`: it carries the fixed development id.

For an update, raise `version` in `extension/manifest.json` first; the store refuses a version that is not higher than the last one.

### Load the release build before uploading

1. `chrome://extensions`, turn on Developer mode, **Load unpacked**, choose `extension-dist/release`.
2. Allow the microphone and camera on the setup page.
3. Record a tab with sound, then a window with the camera bubble, then camera only. Stop each; the first should open app.vistralo.com on the save sheet (this needs step 1's import route in production and you signed in).
4. Close Chrome in the middle of a recording, reopen it, and check the take is on the Recordings page marked interrupted.
5. Remove the unpacked copy before installing from the store, or the two will both be in the toolbar.

## 5. Create the item and fill in the dashboard

1. In the developer dashboard, **New item**, upload the release zip.
2. **Store listing** tab: paste the description, choose the category and language, upload the icon, the five screenshots in order and both promo tiles, and fill the URLs, all from `LISTING.md`.
3. **Privacy practices** tab: paste the single purpose and each permission justification, answer "No" to remote code, tick the data categories and the three certifications as `LISTING.md` lists them, and enter `{{PRIVACY_POLICY_URL}}`.
4. **Distribution** tab: visibility Public, all regions, free.
5. If the dashboard asks for test instructions: recording, recovery and download need no account. "Save to Vistralo" needs a Vistralo account; create a reviewer account in the app's administration and give its email and password in that field only (never in the repository).
6. **Submit for review.** Choose "publish automatically after approval" off if you want to time the release; an approved item then waits up to 30 days for you to publish it.

Review usually takes a few days and can take a few weeks; a new developer account and the `tabCapture` permission (Chrome warns it can "read and change all your data on all websites") make a slower, closer review likely. Google suggests contacting support after three weeks.

## 6. After it is published

- Note the store's extension id. The web app does not need it: the bridge runs from the extension into app.vistralo.com, so no app change or allow-list is required.
- Put the store link on vistralo.com and in the web app where it offers the extension.
- Each update: raise the version, rebuild, run the tests, upload in the same item, and say in the release what changed. Adding a permission with a warning disables the extension for existing users until they accept it, so avoid that unless it is essential.
- If the listing text or images change, edit `LISTING.md` and rerun `npm run store:images`, so the repository keeps matching the store.

## What is ready

| Item | Where |
| --- | --- |
| Release zip that passes its own check | `extension-dist/vistralo-extension-0.1.0-release.zip` (built, not committed) |
| Manifest: name, 127-character summary, icons 16/32/48/128 (128 with store padding), `homepage_url`, `minimum_chrome_version` 116 | `extension/manifest.json` |
| Listing text, single purpose, permission justifications, data-use answers | `store/LISTING.md` |
| Icon, five screenshots, small and marquee promo tiles | `store/images/` |
| Privacy section and Limited Use statement (draft) | `docs/legal/PRIVACY-DRAFT.md` |
| Disclosure inside the extension of where recordings go | the setup page (`pages/welcome.html`) |
