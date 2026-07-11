# Changelog

All notable changes to this project are documented here. Versions follow
[semantic versioning](https://semver.org/). The npm plugin, the JS renderer and
the Python package (`appium-live-view` on PyPI) share one version.

## [0.1.1] — unreleased

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
