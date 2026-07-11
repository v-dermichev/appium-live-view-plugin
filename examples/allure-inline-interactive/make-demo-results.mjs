// Generate a sample allure-results/ containing one test with an appium-live-view
// HTML attachment — so you can see the inline-interactivity patch working without
// a device. No network, no browser, no external tools; just Node.
//
//   node make-demo-results.mjs           -> ./allure-results
//   allure generate allure-results       (allurerc.mjs applies the patch)
//   allure open allure-report
//
// In a real project you would instead attach the HTML returned by the plugin's
// `driver.execute('liveView: render')`, or by buildLiveViewHtml(...). The device
// screenshot here is faked with an SVG drawn from the same parsed rectangles.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource } from "../../lib/parse.js";
import { buildLiveViewHtml } from "../../lib/render.js";
import { ANDROID_XML } from "../../test/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const parsed = parseSource(ANDROID_XML);
const { width, height } = parsed.extents;
const palette = ["#dbeafe", "#dcfce7", "#fef9c3", "#fce7f3", "#e0e7ff", "#ffedd5"];
const xmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const boxes = parsed.nodes
  .filter((n) => n.rect && n.rect.w > 0 && n.rect.h > 0)
  .map((n, i) => {
    const r = n.rect;
    const label = (n.attributes.text || n.attributes["content-desc"] || n.tagName.split(".").pop()).slice(0, 28);
    return (
      `<rect x="${r.x1}" y="${r.y1}" width="${r.w}" height="${r.h}" rx="8" fill="${palette[i % palette.length]}" stroke="#94a3b8" stroke-width="3"/>` +
      `<text x="${r.x1 + 16}" y="${r.y1 + 34}" font-family="sans-serif" font-size="30" fill="#334155">${xmlText(label)}</text>`
    );
  })
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#f8fafc"/>${boxes}</svg>`;
const screenshot = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const html = buildLiveViewHtml({
  parsed,
  screenshot,
  title: "Live view — demo",
  platformName: "Android (demo)",
});

const resultsDir = join(here, "allure-results");
rmSync(resultsDir, { recursive: true, force: true });
mkdirSync(resultsDir, { recursive: true });

const attachmentSource = `${randomUUID()}-attachment.html`;
writeFileSync(join(resultsDir, attachmentSource), html);

// A plain HTML attachment (no live-view markup) attached alongside, to compare
// how Allure sizes the preview iframe — if this one is cramped too, the small
// frame is Allure's preview container, not the live-view HTML's structure.
const plainSource = `${randomUUID()}-attachment.html`;
const plainHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Plain HTML</title></head>
<body style="font-family:sans-serif;margin:16px;line-height:1.5">
<h1>Plain HTML attachment</h1>
<p>Regular HTML, no live-view markup. Total document height is well over 1000px.</p>
${Array.from({ length: 25 }, (_, i) => `<p>Line ${i + 1} — lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join("\n")}
<div style="height:600px;background:linear-gradient(#e0e7ff,#c7d2fe);display:flex;align-items:center;justify-content:center;border-radius:8px">A 600px-tall block</div>
<h2 style="margin-top:24px">End of plain HTML (if you can only see the top, the frame is Allure's)</h2>
</body></html>`;
writeFileSync(join(resultsDir, plainSource), plainHtml);

const start = 1_700_000_000_000;
const result = {
  uuid: randomUUID(),
  historyId: "demo.live_view",
  name: "Live view is interactive inline",
  fullName: "demo.LiveViewDemo#inline",
  status: "passed",
  stage: "finished",
  start,
  stop: start + 3000,
  labels: [
    { name: "suite", value: "appium-live-view" },
    { name: "feature", value: "Live view" },
  ],
  attachments: [
    { name: "Appium live view", source: attachmentSource, type: "text/html" },
    { name: "Plain HTML (frame-size control)", source: plainSource, type: "text/html" },
  ],
};
writeFileSync(join(resultsDir, `${result.uuid}-result.json`), JSON.stringify(result, null, 2));

console.log(`wrote ${resultsDir} (1 test, 2 html attachments: live view + plain control)`);
console.log("next: allure generate allure-results && allure open allure-report");
