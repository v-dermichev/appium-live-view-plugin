# Inline-interactive live view in Allure 3

Make `appium-live-view` HTML attachments **interactive inline** in an Allure 3
report (copy locators, XPath tester with match highlighting) — not just when the
attachment is opened standalone.

It works on **any setup** and has **no hardcoded URLs or paths**: the patch only
reads the generated report's `index.html`. It works for both served and
single-file reports.

## Why it's needed

Allure renders `text/html` attachments through DOMPurify (scripts stripped)
inside `<iframe sandbox="allow-same-origin">` (no `allow-scripts`), so an
attachment's own JavaScript never runs inline. Hover and click-to-pin are pure
CSS and work anyway; copy and the XPath tester need JS.

## How it works

After `allure generate`, the patch inlines a small runtime into the report's
`index.html`. In the browser that runtime finds each attachment iframe whose
(already sanitized) content carries the `data-appium-live-view` marker, and
**swaps the sandboxed `blob:` iframe for a `srcdoc` iframe with `allow-scripts`**,
injecting the interactivity script. `srcdoc` inherits the report's origin, so it
runs for both served (`http`) and single-file (`file://`) reports.

Only live-view frames are touched — every other attachment keeps Allure's
original script-less sandbox. And because DOMPurify already stripped scripts from
the attachment before the swap, the only JS that ever runs is the patch's own.

The page source needed by the XPath tester travels inside the attachment as a
`data-src` (base64) attribute, which survives DOMPurify — the patch does not need
the original results.

## Files

- `patches/make-live-view-interactable.mjs` — the report patch (dependency-free;
  reads/writes only `index.html`).
- `patches/apply.mjs` — tiny harness: resolve the output dir, run the patches.
- `allurerc.mjs` — Allure 3 config that applies the patch after every
  `allure generate` (via a `process.on("exit")` hook).
- `make-demo-results.mjs` — generates a sample `allure-results/` with a live-view
  attachment, so you can see it without a device.

## Try it

```bash
cd examples/allure-inline-interactive
node make-demo-results.mjs                    # -> ./allure-results
allure generate allure-results                # allurerc.mjs applies the patch
allure open allure-report                     # served: fully interactive
# single-file also works: set awesome.singleFile=true in allurerc.mjs, then open
# allure-report/index.html directly (file://).
```

Open the test → the *Appium live view* attachment → Preview. Click a locator to
copy it; type an XPath (e.g. `//android.widget.Button`) to highlight matches.

## Use it in your project

Copy `allurerc.mjs` and `patches/` into your project (next to where you run
`allure generate`), and point `allure` at the config if it isn't picked up
automatically:

```bash
allure generate allure-results --config ./allurerc.mjs
```

Produce the live-view attachments from your tests with the plugin's
`driver.execute('liveView: render')` (see the repo root README), or by calling
`buildLiveViewHtml(...)` and attaching the result as `text/html`.
