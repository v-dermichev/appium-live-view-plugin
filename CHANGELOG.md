# Changelog

All notable changes to this project are documented here. Versions follow
[semantic versioning](https://semver.org/). The npm plugin, the JS renderer and
the Python package (`appium-live-view` on PyPI) share one version.

## [0.1.3] — 2026-07-13

### Changed

- **Smaller attachments for large pages.** The live view no longer duplicates each
  locator string (the copy handler reads the visible `<code>` text instead of a
  `data-copy` attribute), the "click to copy" hint is drawn from CSS rather than
  repeated in markup, CSS class selectors are capped to the first 3 classes
  (utility-CSS frameworks put dozens on an element), and the per-node panel/locator
  markup is emitted without indentation. On a ~1700-node page the HTML drops ~18%
  (e.g. 4.1 MB → 3.4 MB) with no change in behaviour.

## [0.1.2] — 2026-07-13

### Fixed

- **Suggested WebView locators now resolve in the tester.** The locator tester
  evaluates against an HTML mirror of the source rooted at the page's `<html>` (the
  `<webview>` wrapper stripped), so the exact locators shown in the panel — an
  absolute `/html/body/…` XPath, `#id` / `.class` / `[attr]` CSS — all match, where
  before the wrapper made absolute XPaths report "no match".
- **The "hover an element" placeholder no longer shows above a pinned panel.** When
  an element is selected (including a pre-selected `selectedPath`), the placeholder
  hides and only the element's panel shows.
- **Allure report patch: attachments reliably expand to full height.** The report
  runtime now re-asserts the fitted height whenever Allure re-applies its own
  iframe sizing (on expand / re-render), so an expanded live view no longer
  sometimes stays collapsed in the thin default preview strip.

### Added

- **WebView / hybrid context.** A DOM snapshot script (`WEB_SNAPSHOT_JS`, run via
  `driver.execute_script` in a webview) captures each element's tag, attributes and
  `getBoundingClientRect()` into the bounds-annotated source the live view
  consumes — so hybrid pages get a live view too. Take a web-viewport screenshot;
  the renderer auto-detects the web context and suggests **CSS + DOM-XPath**
  locators (or force it with `context: "web"`). Exposed from the JS package
  (`lib/web-snapshot.js`) and the Python package (`WEB_SNAPSHOT_JS`).
  The web coordinate space is taken from the **screenshot's own pixel size**
  (÷ the snapshot's `devicePixelRatio`), so overlays line up per device even when
  the mobile URL bar shows/hides between the snapshot and the screenshot (which
  changes `innerHeight`), and across a **device switch** (each device's dpr and
  viewport are handled from its own snapshot).
- **Locator tester with a strategy dropdown.** The header tester is one input with
  a **CSS / XPath** dropdown to its left (CSS offered only in web / hybrid HTML
  contexts). Type a selector to highlight every matching element on the screenshot
  and in the tree, with a live match count. CSS supports `#id`, `.class`,
  `tag[attr=…]` and combinators.
- **Landscape layout for horizontal screenshots.** When the screenshot is wider
  than tall (desktop web, a rotated device), the live view stacks — a large
  full-width stage on top, the source tree + attribute/locator panel in a row
  beneath it, all clamped to the screenshot width and centred — instead of
  squeezing a wide screenshot into a narrow side column. The "hover an element"
  hint moves above the screenshot. Portrait (mobile) keeps the stage-beside-panel
  layout.
- **Full-device web screenshots (iOS Safari / hybrid WebView below a native bar).**
  The snapshot now also records the device `screen` size, so the renderer can tell a
  full-device screenshot (screenshot == screen, e.g. iOS Safari with its status bar
  and toolbar) from a bare web-viewport screenshot (Android Chrome). For a
  full-device screenshot the web content starts below the top chrome; the offset
  isn't visible to the page (`window.screenY` and safe-area insets both report 0), so
  it's supplied via the new **`webviewRect`** option (JS) / **`webview_rect`**
  (Python) — the WebView's on-screen rectangle in CSS px, e.g. from Appium's native
  context. Overlays are shifted by it. Android and viewport screenshots need nothing
  (offset 0, auto).

## [0.1.1] — 2026-07-11

### Fixed

- **iOS overlays now align with the screenshot.** The overlay coordinate space is
  taken from the app/window element (the device screen) instead of the maximum
  element extent. iOS reports off-screen scrollable content (carousels, long
  scroll views) with bounds far beyond the screen, which previously inflated the
  coordinate space and squashed every overlay into the top-left. Android was
  unaffected (uiautomator2 clips bounds to the screen).
- **No more phantom overlays on iOS.** Elements marked `visible="false"` (and
  Android `displayed="false"`) no longer get an overlay — iOS reports on-screen
  coordinates for occluded / not-scrolled-in elements, which drew overlays over
  unrelated on-screen elements. Such elements stay selectable via the source tree.
- **Fewer, cleaner iOS overlays.** Elements marked `accessible="false"` (layout
  containers — windows, nested `Other` wrappers, scroll views — and redundant inner
  images/labels) no longer get an overlay, removing the deep-nesting clutter and
  leaving the interactive, locatable elements. They stay selectable via the tree.
- **Selecting an element no longer jumps the page to the top** (the hidden
  selection radios are now `position:fixed`).

### Added

- **The source tree follows selection.** Picking an element (on the screenshot or
  in the tree) scrolls the source tree to center that element — scrolling only the
  tree, never the page.
- **Dotted outline for not-shown elements.** Occluded / non-accessibility elements
  have no overlay by default, but selecting one in the source tree now draws a
  dotted outline where the driver reports it.
- **Fully on-screen elements render above partially off-screen ones,** so a
  fixed/stable element (e.g. a bottom tab bar) stays hoverable and clickable even
  when a half-scrolled element's box would otherwise cover it.
- **Smaller elements stay clickable.** At the same depth, a smaller element now
  renders above a larger sibling (ranked by area), so a small icon / close button
  isn't covered by a big neighbouring box.

## [0.1.0] — 2026-07-11

### Added

- Initial release.
- Appium 2/3 server plugin: `execute('liveView: render')` / `liveView: status`,
  returning a self-contained, interactive HTML live view for the current session.
- Framework-agnostic JS renderer (`lib/render.js`, `buildLiveViewHtml`) — hover to
  highlight, click to pin attributes + suggested locators, a selectable source
  tree, an XPath tester, and XML/screenshot download links.
- Python package [`appium-live-view`](https://pypi.org/project/appium-live-view/) —
  the same renderer, no Node required.
- Optional Allure 3 report patch (`examples/allure-inline-interactive/`) that makes
  the HTML attachment interactive inline (served and single-file reports).
