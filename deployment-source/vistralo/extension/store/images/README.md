# Store images

Made by `npm run store:images` (`scripts/extension-store-images.cjs`) from the real extension and web app, not drawn by hand. Rerun it after a change to the popup, the page bar, the recordings page, the setup page or the app's save sheet.

| File | Size | What it shows |
| --- | --- | --- |
| `store-icon-128.png` | 128×128 | The emblem at 96 px with 16 px of transparent padding. Also copied to `extension/icons/icon-128.png` |
| `screenshot-1-choose.png` | 1280×800 | The toolbar popup over a page, set to record a window or screen with microphone, camera and bubble |
| `screenshot-2-recording.png` | 1280×800 | A recording under way: the bar on the page and the camera bubble |
| `screenshot-3-open-in-vistralo.png` | 1280×800 | After Stop: the web app's save sheet with the recording |
| `screenshot-4-recordings.png` | 1280×800 | The extension's recordings page with a finished take |
| `screenshot-5-setup.png` | 1280×800 | The setup page, including "Where your recordings go" |
| `promo-small-440x280.png` | 440×280 | Emblem, name and one line on the indigo field |
| `promo-marquee-1400x560.png` | 1400×560 | Name and line on the ink field, with the bar, bubble and popup from a real recording |

How they are made:

- The dev extension is loaded into Chrome for Testing. One browser has Chrome's test microphone and a still stand-in camera picture (a plain figure, so no real person appears); the other records a real tab with no devices.
- The page recorded is the web app's own fictional sample storefront ("fernhill goods", from `server-ui/assets/sample-walkthrough.mp4`), not a real website.
- The web app runs in its demo mode. Its demo-only notice in the save sheet is removed before the picture, because the signed-in app does not show it; the rail still says "Demo workspace".
- Chrome's test devices are named "Fake Default Audio Input" and so on; in the popup picture they are renamed "Built-in microphone" and "Built-in camera". Nothing else in a capture is changed.
- Captions and frames use the app's tokens (`web/styles/tokens.css`) and fonts, and the black film edge the app puts around media.

To run it: `npm run build:server`, then `VISTRALO_TEST_CHROMIUM=/path/to/chrome-for-testing npm run store:images`. Raw captures go to `evidence/store-raw/` (not committed). `VISTRALO_STORE_COMPOSE=1` recomposes from existing captures without recording again.
