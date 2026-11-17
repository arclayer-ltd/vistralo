'use strict';
// Makes the Chrome Web Store images in extension/store/images/ from the real extension.
//
// 1. Captures: loads the dev extension into Chrome for Testing with Chrome's test microphone and a
//    still stand-in camera picture, records the web app's demo library, and photographs the popup,
//    the bar and camera bubble on the page, the recordings page, the setup page and the app's import
//    sheet. The only things changed in a capture are device names ("Fake Default Audio Input"
//    becomes "Built-in microphone"), because Chrome's test devices carry test names.
// 2. Composes: lays those captures into the store sizes with a one-line caption, using the app's
//    tokens and fonts, and renders the icon and promo tiles from the emblem.
//
//   VISTRALO_TEST_CHROMIUM   Chrome for Testing or Chromium (branded Chrome ignores --load-extension)
//   VISTRALO_STORE_RAW       Folder for the raw captures (default evidence/store-raw)
//   VISTRALO_STORE_COMPOSE=1 Skip capturing and compose from existing raw captures
// Build the app first with npm run build:server; this builds the dev extension itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { serve } = require('./static-server.cjs');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'extension-dist', 'dev');
const raw = path.resolve(process.env.VISTRALO_STORE_RAW || path.join(root, 'evidence', 'store-raw'));
const out = path.join(root, 'extension', 'store', 'images');
const APP_PORT = 4388;
const extensionId = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'dev-key.json'), 'utf8')).id;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fontsDir = path.join(root, 'server-ui', 'assets', 'fonts');
const tokens = fs
  .readFileSync(path.join(root, 'web', 'styles', 'tokens.css'), 'utf8')
  .replace(/url\("\/assets\/fonts\/([^"]+)"\)/g, (_, f) => `url("${pathToUrl(path.join(fontsDir, f))}")`);
const emblem = fs.readFileSync(path.join(root, 'extension', 'icons', 'emblem.svg'), 'utf8').replace(/<title[\s\S]*?<\/desc>/, '');

function pathToUrl(file) {
  return 'file:///' + file.split(path.sep).join('/');
}
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

/** Renders an HTML page with the app's tokens to a PNG of exactly this size. */
async function render(browser, html, file, width, height, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${tokens}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;${transparent ? 'background:transparent' : 'background:var(--bg-page)'}}
body{font-family:var(--font-family);color:var(--fg-1);-webkit-font-smoothing:antialiased}
</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  await page.close();
}

/** A still picture for Chrome's fake camera: a plain figure, so no real person is shown. */
async function standInCamera(browser) {
  const png = path.join(raw, 'camera-stand-in.png');
  await render(
    browser,
    `<svg width="640" height="480" viewBox="0 0 640 480" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="480" fill="#dfe3ec"/>
      <circle cx="320" cy="200" r="78" fill="#9aa3b8"/>
      <path d="M150 480c10-110 80-170 170-170s160 60 170 170z" fill="#9aa3b8"/>
    </svg>`,
    png,
    640,
    480,
  );
  const y4m = path.join(raw, 'camera-stand-in.y4m');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-i', png, '-t', '1', '-r', '30', '-pix_fmt', 'yuv420p', y4m]);
  return y4m;
}

/**
 * The page recorded in the pictures: the app's fictional sample storefront. Its sample video plays
 * on the page (as WebM, which Chromium plays), so the recordings have motion in them.
 */
function storefront() {
  const http = require('node:http');
  const poster = fs.readFileSync(path.join(root, 'server-ui', 'assets', 'walkthrough-poster-1240.webp'));
  const webm = path.join(raw, 'storefront.webm');
  if (!fs.existsSync(webm))
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(root, 'server-ui', 'assets', 'sample-walkthrough.mp4'), '-an', '-c:v', 'libvpx-vp9', '-b:v', '2M', webm]);
  const video = fs.readFileSync(webm);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/poster.webp') {
        res.setHeader('content-type', 'image/webp');
        return res.end(poster);
      }
      if (req.url === '/storefront.webm') {
        res.setHeader('content-type', 'video/webm');
        return res.end(video);
      }
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html><head><title>fernhill goods</title><style>
html,body{margin:0;height:100%;background:#f1efe8;overflow:hidden}video{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
</style></head><body><video src="/storefront.webm" poster="/poster.webp" autoplay muted loop playsinline></video></body></html>`);
    });
    server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** One browser with the dev extension; `fakeDevices` gives it Chrome's test microphone and the stand-in camera. */
async function session(camera, site, run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vistralo-store-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.VISTRALO_TEST_CHROMIUM,
    headless: process.env.VISTRALO_HEADFUL !== '1',
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      // Chrome's test devices break tab capture, so only the session that needs them has them.
      ...(camera ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camera}`] : []),
      `--allowlisted-extension-id=${extensionId}`,
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    assert.equal(new URL(worker.url()).host, extensionId);
    // Close the setup tab the extension opens on install; it is photographed on its own.
    await wait(1000);
    for (const p of context.pages()) if (p.url().includes('welcome.html')) await p.close();
    const control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/popup.html`);
    const snapshot = () => control.evaluate(async () => (await chrome.storage.session.get('session')).session ?? null);
    const t = {
      context,
      control,
      send: (m) => control.evaluate((x) => chrome.runtime.sendMessage(x), m),
      until: async (test, ms = 20000) => {
        const end = Date.now() + ms;
        let last;
        while (Date.now() < end) {
          last = await snapshot();
          if (test(last)) return last;
          await wait(200);
        }
        throw new Error(`Timed out waiting for the recording; last snapshot ${JSON.stringify(last)}`);
      },
      setOptions: (o) => control.evaluate((x) => chrome.storage.local.set({ options: x }), o),
      tabOf: async (page) => {
        await page.bringToFront();
        return control.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id ?? null);
      },
      findPage: async (test) => {
        for (let i = 0; i < 75; i++) {
          const found = context.pages().find(test);
          if (found) return found;
          await wait(200);
        }
        return null;
      },
    };
    t.page = await context.newPage();
    await t.page.goto(site.origin + '/');
    await t.page.waitForLoadState('networkidle');
    await run(t);
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

async function capture() {
  fs.mkdirSync(raw, { recursive: true });
  execFileSync(process.execPath, [path.join(__dirname, 'build-extension.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, VISTRALO_EXTENSION_TARGET: 'dev', VISTRALO_EXTENSION_APP_ORIGIN: `http://127.0.0.1:${APP_PORT}`, VISTRALO_EXTENSION_DEMO: '1' },
  });
  assert.ok(fs.existsSync(path.join(root, 'server-ui', 'app.js')), 'Build the web app first (npm run build:server).');
  assert.ok(process.env.VISTRALO_TEST_CHROMIUM && fs.existsSync(process.env.VISTRALO_TEST_CHROMIUM), 'Set VISTRALO_TEST_CHROMIUM to Chrome for Testing.');

  const helper = await chromium.launch({ executablePath: process.env.VISTRALO_TEST_CHROMIUM });
  const camera = await standInCamera(helper);
  await helper.close();
  const app = await serve(APP_PORT);
  const site = await storefront();
  const base = { mode: 'screen', microphone: 'default', camera: 'default', bubble: true, bubbleSize: 'medium', systemAudio: true, countdown: true, openWhenDone: true };

  try {
    // 1. The popup, the bar and the camera bubble: Chrome's test microphone and the stand-in camera.
    await session(camera, site, async (t) => {
      await t.setOptions(base);
      await t.page.screenshot({ path: path.join(raw, 'page.png') });
      // Chrome's test devices carry test names; a store picture shows ordinary ones.
      const plainDevices = (p) =>
        p.evaluate(() => {
          for (const option of document.querySelectorAll('option')) {
            if (/audio/i.test(option.textContent)) option.textContent = 'Built-in microphone';
            else if (/fake|video|camera|stand-in|y4m/i.test(option.textContent) && option.value) option.textContent = 'Built-in camera';
          }
        });
      const popup = await t.context.newPage();
      await popup.setViewportSize({ width: 420, height: 900 });
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.waitForSelector('#start');
      await wait(800);
      await plainDevices(popup);
      await popup.locator('main.popup').screenshot({ path: path.join(raw, 'popup-setup.png') });

      const tabId = await t.tabOf(t.page);
      assert.deepEqual(await t.send({ to: 'background', type: 'start', tabId, options: base }), { ok: true });
      await t.until((s) => s && s.phase === 'countdown');
      await wait(700);
      await t.page.screenshot({ path: path.join(raw, 'countdown.png') });
      await t.until((s) => s && s.phase === 'recording');
      await wait(4200);
      const bubble = t.page.frames().find((f) => f.url().includes('/camera.html'));
      assert.ok(bubble, 'the camera bubble is on the page');
      await bubble.waitForFunction(() => document.querySelector('video').videoWidth > 0, null, { timeout: 10000 });
      await t.page.mouse.move(1270, 790);
      await t.page.screenshot({ path: path.join(raw, 'recording.png') });

      await popup.reload();
      await popup.waitForSelector('#session:not([hidden])');
      await wait(1500);
      await popup.locator('main.popup').screenshot({ path: path.join(raw, 'popup-session.png') });
      await t.send({ to: 'background', type: 'control', action: 'cancel' });
      await t.until((s) => s && s.phase === 'cancelled');

      const welcome = await t.context.newPage();
      await welcome.setViewportSize({ width: 1280, height: 800 });
      await welcome.goto(`chrome-extension://${extensionId}/welcome.html`);
      await welcome.waitForSelector('#allow-mic');
      await welcome.click('#allow-mic');
      await welcome.click('#allow-cam');
      await wait(1000);
      await welcome.screenshot({ path: path.join(raw, 'welcome.png') });
    });

    // 2. What a recording looks like afterwards: a real tab capture of the storefront, no devices.
    await session(null, site, async (t) => {
      const tab = { ...base, mode: 'tab', microphone: null, camera: null, bubble: false, countdown: false };
      await t.setOptions(tab);
      const tabId = await t.tabOf(t.page);
      assert.deepEqual(await t.send({ to: 'background', type: 'start', tabId, options: tab }), { ok: true });
      await t.until((s) => s && s.phase === 'recording');
      await wait(3500);
      await t.send({ to: 'background', type: 'control', action: 'stop' });
      await t.until((s) => s && s.phase === 'ready');
      const appPage = await t.findPage((p) => p.url().startsWith(app.origin));
      assert.ok(appPage, 'the app opens on the recording');
      await appPage.setViewportSize({ width: 1280, height: 800 });
      await appPage.waitForSelector('dialog[open] video.flow-recording-preview', { timeout: 20000 });
      await appPage.evaluate(() => {
        // The demo's own notice ("projects stay in this browser") is not shown in the signed-in app.
        for (const el of document.querySelectorAll('dialog[open] *'))
          if (el.children.length < 3 && /^Demo workspace:/.test(el.textContent.trim())) {
            el.closest('div,p,section')?.remove();
            break;
          }
        const v = document.querySelector('video.flow-recording-preview');
        v.currentTime = 1.5;
      });
      await wait(1500);
      await appPage.screenshot({ path: path.join(raw, 'app-import.png') });
      await appPage.close();

      await t.setOptions({ ...tab, openWhenDone: false });
      await t.page.bringToFront();
      assert.deepEqual(await t.send({ to: 'background', type: 'start', tabId, options: { ...tab, openWhenDone: false } }), { ok: true });
      await t.until((s) => s && s.phase === 'recording');
      await wait(3500);
      await t.send({ to: 'background', type: 'control', action: 'stop' });
      const kept = await t.until((s) => s && s.phase === 'ready');
      const resultPage = await t.findPage((p) => p.url() === `chrome-extension://${extensionId}/recorder.html#${kept.id}`);
      assert.ok(resultPage, 'the recordings page opens');
      await resultPage.setViewportSize({ width: 1280, height: 800 });
      await resultPage.waitForSelector('#result:not([hidden])');
      await resultPage.evaluate(() => {
        document.querySelector('#result-video').currentTime = 1.5;
      });
      await wait(1500);
      await resultPage.screenshot({ path: path.join(raw, 'recordings.png') });
    });
  } finally {
    await app.close();
    site.close();
  }
}

// ---- Composition -------------------------------------------------------------------------------

const brand = (size) => `<span style="display:inline-flex;width:${size}px;height:${size}px">${emblem.replace('width="32" height="32"', `width="${size}" height="${size}"`)}</span>`;

/**
 * A 1280x800 screenshot: a caption band on paper, then the whole real capture (1280x800, shown at
 * 1094x684) in the black film edge the app puts around media.
 */
const SHOT_W = 1094;
const shot = (title, line, inner) => `
<div style="display:grid;grid-template-rows:104px auto;justify-items:center;height:800px">
  <header style="display:flex;align-items:center;gap:18px;width:${SHOT_W + 12}px">
    ${brand(40)}
    <div>
      <h1 style="margin:0;font-family:var(--font-display);font-stretch:var(--stretch-display);font-weight:var(--weight-display);font-size:30px;line-height:36px;letter-spacing:var(--tracking-title)">${title}</h1>
      <p style="margin:4px 0 0;font-size:17px;line-height:24px;color:var(--fg-2)">${line}</p>
    </div>
  </header>
  <div style="position:relative;width:${SHOT_W}px;height:684px;border:6px solid var(--rebate);border-radius:var(--radius-frame);overflow:hidden;background:var(--bg-page)">${inner}</div>
</div>`;
const img = (file, style = '') => `<img src="${dataUrl(path.join(raw, file))}" style="display:block;${style}">`;
const lifted = 'box-shadow:var(--shadow);border:1px solid var(--divider);border-radius:var(--radius-card)';

async function compose() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.VISTRALO_TEST_CHROMIUM || undefined });
  try {
    const W = SHOT_W;
    await render(
      browser,
      shot(
        'Record a tab, a window, your screen or your camera',
        'Choose a microphone and camera, then start. Your choices are kept for next time.',
        `${img('page.png', `width:${W}px`)}
         <div style="position:absolute;inset:0;background:var(--backdrop)"></div>
         <div style="position:absolute;top:8px;right:24px;${lifted};overflow:hidden">${img('popup-setup.png', 'height:620px')}</div>`,
      ),
      path.join(out, 'screenshot-1-choose.png'),
      1280,
      800,
    );
    await render(
      browser,
      shot(
        'Controls stay on the page while you record',
        'Pause, start over, discard, mute and stop from the bar. Your camera shows in a bubble.',
        img('recording.png', `width:${W}px`),
      ),
      path.join(out, 'screenshot-2-recording.png'),
      1280,
      800,
    );
    await render(
      browser,
      shot(
        'Stop, and it opens in Vistralo',
        'Choose an AI-narrated walkthrough or keep your own voice. It saves to your Vistralo account.',
        img('app-import.png', `width:${W}px`),
      ),
      path.join(out, 'screenshot-3-open-in-vistralo.png'),
      1280,
      800,
    );
    await render(
      browser,
      shot(
        'Nothing is lost if Chrome closes',
        'Recordings are written to this browser every second and wait here until you save, download or discard them.',
        img('recordings.png', `width:${W}px`),
      ),
      path.join(out, 'screenshot-4-recordings.png'),
      1280,
      800,
    );
    await render(
      browser,
      shot(
        'Microphone and camera only while you record',
        'Set up once. The extension has no account of its own and no analytics.',
        img('welcome.png', `width:${W}px`),
      ),
      path.join(out, 'screenshot-5-setup.png'),
      1280,
      800,
    );

    // Store icon: 96px of artwork with 16px of transparent padding, as the store asks.
    await render(browser, `<div style="padding:16px">${brand(96)}</div>`, path.join(out, 'store-icon-128.png'), 128, 128, { transparent: true });
    // The same file is the extension's own 128px icon.
    fs.copyFileSync(path.join(out, 'store-icon-128.png'), path.join(root, 'extension', 'icons', 'icon-128.png'));

    // Small promo tile, 440x280: the emblem and one line, readable when small.
    await render(
      browser,
      `<div style="height:280px;display:grid;align-content:center;gap:18px;padding:0 40px;background:var(--accent);color:var(--primary-fg)">
        <div style="display:flex;align-items:center;gap:14px">${brand(52)}
          <span style="font-family:var(--font-display);font-stretch:var(--stretch-display);font-weight:var(--weight-display);font-size:38px;color:var(--overlay-fg)">Vistralo</span></div>
        <p style="margin:0;font-size:24px;line-height:31px;font-weight:var(--weight-medium);color:var(--overlay-fg)">Record your screen.<br>Get a narrated walkthrough.</p>
      </div>`,
      path.join(out, 'promo-small-440x280.png'),
      440,
      280,
    );

    // Marquee, 1400x560: the line on the left, the real popup and bar on the right.
    await render(
      browser,
      `<div style="height:560px;display:grid;grid-template-columns:560px 1fr;background:var(--rebate);color:var(--overlay-fg);overflow:hidden">
        <div style="display:grid;align-content:center;gap:22px;padding:0 0 0 72px">
          <div style="display:flex;align-items:center;gap:16px">${brand(56)}
            <span style="font-family:var(--font-display);font-stretch:var(--stretch-display);font-weight:var(--weight-display);font-size:40px">Vistralo</span></div>
          <p style="margin:0;font-family:var(--font-display);font-stretch:var(--stretch-display);font-weight:var(--weight-display);font-size:44px;line-height:50px;letter-spacing:var(--tracking-title)">Record it once.<br>Explain it clearly.</p>
          <p style="margin:0;font-size:19px;line-height:28px;color:var(--edge-print)">Record a tab, window, screen or camera, then turn it into a narrated walkthrough in Vistralo.</p>
        </div>
        <div style="position:relative">
          <div style="position:absolute;left:24px;top:56px;width:960px;border:6px solid var(--fg-2);border-radius:var(--radius-card);overflow:hidden">${img('recording.png', 'width:960px')}</div>
          <div style="position:absolute;left:520px;top:36px;${lifted};overflow:hidden;border-color:var(--fg-2)">${img('popup-session.png', 'width:300px')}</div>
        </div>
      </div>`,
      path.join(out, 'promo-marquee-1400x560.png'),
      1400,
      560,
    );
  } finally {
    await browser.close();
  }
  console.log(`Wrote the store images to ${path.relative(root, out)}`);
}

(async () => {
  if (process.env.VISTRALO_STORE_COMPOSE !== '1') await capture();
  await compose();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
