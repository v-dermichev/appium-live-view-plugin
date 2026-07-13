// appium-live-view-plugin: turns the active session's page source + screenshot
// into a single self-contained, interactive HTML "live view" (the Appium
// Inspector experience — hover to highlight, click to inspect an element's
// attributes and suggested locators) and returns it to the test client via
// `execute('liveView: ...')` commands.
//
// The returned HTML is ready to hand straight to a reporter, e.g.
//   allure.attach(html, "Live view", AttachmentType.HTML)  # any client language
//
// It renders inline inside an Allure report (pure-CSS interactivity survives
// Allure's DOMPurify + sandboxed iframe) and unlocks copy-to-clipboard / filter
// when opened standalone.
import { BasePlugin } from '@appium/base-plugin';

import { buildLiveViewHtml } from './lib/render.js';

const PLUGIN_VERSION = '0.1.4';

class LiveViewPlugin extends BasePlugin {
  static executeMethodMap = {
    'liveView: render': {
      command: 'liveViewRender',
      params: {optional: ['title', 'source', 'screenshot', 'selectedPath', 'platformName']},
    },
    'liveView: status': {
      command: 'liveViewStatus',
      params: {},
    },
  };

  async execute(next, driver, script, args) {
    return await this.executeMethod(next, driver, script, args);
  }

  // Health surface — lets a client assert the plugin is loaded before relying
  // on it. Mirrors the shape of other plugins' `status` command.
  async liveViewStatus() {
    return {available: true, plugin: 'liveView', version: PLUGIN_VERSION};
  }

  // Build the live view for the current session and return the HTML string.
  //
  // `source` / `screenshot` are optional: when omitted they are captured from
  // the driver now; when supplied (base64 PNG for the screenshot) the plugin
  // renders already-captured data — useful for attaching the exact source and
  // screenshot a test step observed, rather than a fresh grab.
  async liveViewRender(
    next,
    driver,
    title = 'Appium live view',
    source = null,
    screenshot = null,
    selectedPath = null,
    platformName = null,
  ) {
    const xml = source || (await driver.getPageSource());
    const shot = screenshot || (await driver.getScreenshot());
    const platform =
      platformName || driver?.caps?.platformName || driver?.opts?.platformName || null;

    return buildLiveViewHtml({
      xml,
      screenshot: shot,
      title,
      selectedPath,
      platformName: platform,
    });
  }
}

export { LiveViewPlugin };
export default LiveViewPlugin;
