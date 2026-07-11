# appium-live-view-plugin

An [Appium](https://appium.io) plugin that turns the active session's **page
source + screenshot** into a single, self-contained, interactive **HTML "live
view"** — the [Appium Inspector](https://github.com/appium/appium-inspector)
experience (hover to highlight an element, click to pin its attributes and
suggested locators) — and hands that HTML back to the test client via
`execute('liveView: …')`.

Because it returns a ready-to-use HTML string over the standard Execute Script
endpoint, it is **consumer-agnostic**: any Appium client (Python, Java, JS, …)
can grab it and drop it straight into a report. Attaching it to Allure is one
line:

```python
allure.attach(html, "Live view", allure.attachment_type.HTML)
```

## Why a plugin that returns HTML, instead of an Allure plugin?

The original idea was an Allure 3 plugin adding a new *attachment renderer*.
Allure 3's plugin API does not allow that: `@allurereport/plugin-api` exposes
only generation-time Node hooks (`start`/`update`/`done`/`info`) with a
read-only store and `reportFiles.addFile`; the web UI picks an attachment
renderer from a **hard-coded compile-time map** in
`web-components/.../Attachment.tsx`, with no registration hook. Adding a native
renderer means forking and rebuilding `web-awesome`, not shipping a plugin.

So the live view is delivered as a **`text/html` attachment** instead, which
Allure already renders. That imposes one constraint the HTML is built around:

> Allure runs `text/html` attachments through **DOMPurify** and shows them in
> `<iframe sandbox="allow-same-origin">` — **no `allow-scripts`**. JavaScript is
> stripped and cannot run inline.

Therefore all core interactivity is **pure CSS** (hover via `:hover`,
click-to-pin via the hidden-radio `:checked` technique), which DOMPurify keeps
and the sandbox allows. When the attachment is opened/downloaded standalone,
scripts run and a small enhancement layer adds copy-to-clipboard on locators and
a filter box. Nothing essential depends on JS.

This also means the same command works with **Allure 2** and any other reporter
that renders HTML attachments, and the plugin has **zero Allure dependency**.

## How the "live view" mapping works (extracted from Appium Inspector)

The data half of Inspector's screenshot↔source mapping is small and pure; it is
reimplemented here without a DOM (`lib/parse.js`) so it runs both on the server
and inside the rendered page:

- `parseCoordinates(attrs)` → `{x1,y1,x2,y2}` from Android `bounds="[x1,y1][x2,y2]"`
  or iOS `x`/`y`/`width`/`height`.
- `parseSource(xml)` → flat node list with per-node rect, path, attributes, and
  the source coordinate **extents** (largest `x2`/`y2`).
- Overlays are positioned as **percentages of the extents**, so they line up on
  the screenshot regardless of device pixel density (no scale-ratio math).

`lib/locators.js` adds suggested locators (accessibility id, id/resource-id,
attribute-scoped XPath, absolute XPath). `lib/render.js` assembles the HTML.

## Install & enable

```bash
# from git (git source REQUIRES --package with the package name)
appium plugin install --source=git \
  https://github.com/<you>/appium-live-view-plugin.git \
  --package appium-live-view-plugin
# or from a local checkout
appium plugin install --source=local /path/to/appium-live-view-plugin
# or from npm (once published)
appium plugin install --source=npm appium-live-view-plugin

# enable it (alongside any other plugins)
appium --use-plugins=liveView
```

Requires Appium 2 or 3. No system dependencies; no runtime npm dependencies
beyond `@appium/base-plugin`.

## Commands

```js
// Health check — assert the plugin is loaded.
await driver.execute('liveView: status');
// -> { available: true, plugin: 'liveView', version: '0.1.0' }

// Render the CURRENT screen (plugin grabs source + screenshot itself).
const html = await driver.execute('liveView: render', [{ title: 'Login screen' }]);

// Render data you already captured (e.g. the exact state a step observed).
const html2 = await driver.execute('liveView: render', [{
  title: 'After tap',
  source: capturedPageSourceXml,   // optional; captured now if omitted
  screenshot: capturedBase64Png,   // optional; captured now if omitted
  selectedPath: '1.2.0',           // optional; pre-pin an element by its node path
}]);
```

`render` returns the HTML document as a string, ready to attach.

### Parameters (all optional)

| param | default | meaning |
|-------|---------|---------|
| `title` | `Appium live view` | header / document title |
| `source` | live `getPageSource()` | page-source XML to render |
| `screenshot` | live `getScreenshot()` | base64 PNG to render |
| `selectedPath` | – | node `path` to pre-select (dot-separated child indices) |
| `platformName` | session caps | shown in the header |

## Allure usage

### Python (pytest + allure-pytest)

```python
import allure

def attach_live_view(driver, name="Live view", **kwargs):
    html = driver.execute_script("liveView: render", kwargs)
    allure.attach(html, name, allure.attachment_type.HTML)

# in a test / fixture / failure hook:
attach_live_view(driver, title="Checkout screen")
```

### JavaScript (WebdriverIO)

```js
const html = await browser.execute('liveView: render', [{ title: 'Cart' }]);
await allure.addAttachment('Live view', html, 'text/html');
```

Inside the Allure report the attachment shows the screenshot with hoverable,
clickable element overlays. Open it in a new tab for copy-to-clipboard locators.

## Try it without a device

```bash
npm test                              # unit tests (parser, locators, renderer)
```

The demo replaces the device screenshot with an SVG drawn from the same parsed
rectangles, so the overlays sit exactly on top of it.

## Limitations

- Inline in Allure, only CSS interactions run (hover + click-pin); copy/filter
  need the attachment opened standalone (script sandbox).
- Web/hybrid contexts: only the native page source is mapped. Switch to a native
  context (or capture source there) for meaningful overlays.
- Overlap handling is DOM stacking (deepest element wins hit-testing), not the
  centroid fan-out Appium Inspector draws for exactly-overlapping elements.

## License

MIT
