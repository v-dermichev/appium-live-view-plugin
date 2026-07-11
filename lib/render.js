// Render a parsed Appium source + screenshot into a single self-contained,
// interactive HTML document — the "live view".
//
// The output is designed for two very different runtime environments:
//
//   1. Inline inside an Allure report. Allure runs `text/html` attachments
//      through DOMPurify and shows them in `<iframe sandbox="allow-same-origin">`
//      (no `allow-scripts`). So JavaScript never runs there. All core
//      interactivity — hover-to-highlight, tooltip, and click-to-pin an element
//      with its attributes + locators — is therefore pure CSS, using the
//      hidden-radio (`:checked`) technique, which DOMPurify preserves.
//
//   2. Standalone, when the attachment is opened/downloaded in its own tab.
//      Here scripts run, so a small progressive-enhancement layer adds
//      copy-to-clipboard on locators and a filter box. Nothing essential
//      depends on it.

import { suggestLocators } from './locators.js';
import { parseSource } from './parse.js';

const TIP_ATTRS = ['resource-id', 'content-desc', 'text', 'name', 'label', 'value', 'type', 'class'];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(4)}%` : '0%';
}

function tipLabel(node) {
  const a = node.attributes || {};
  for (const key of TIP_ATTRS) {
    if (a[key]) {
      return `${node.tagName} · ${a[key]}`;
    }
  }
  return node.tagName;
}

function normalizeScreenshot(screenshot) {
  if (!screenshot) {
    return '';
  }
  return screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`;
}

function renderPanel(node) {
  const attrs = node.attributes || {};
  const rows = Object.keys(attrs)
    .map(
      (key) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(attrs[key])}</td></tr>`,
    )
    .join('');

  const locators = suggestLocators(node)
    .map(
      (loc) => `
        <li>
          <div class="lv-loc-head"><span class="lv-loc-type">${escapeHtml(loc.type)}</span>
            <button type="button" class="lv-copy" data-copy="${escapeHtml(loc.value)}">copy</button></div>
          <code class="lv-loc-value">${escapeHtml(loc.value)}</code>
        </li>`,
    )
    .join('');

  const rect = node.rect
    ? `<div class="lv-rect">x ${node.rect.x1}, y ${node.rect.y1} · ${node.rect.w}×${node.rect.h}</div>`
    : '';

  return `
    <div class="lv-panel lv-panel-${node.index}">
      <div class="lv-panel-head"><span class="lv-tag">${escapeHtml(node.tagName)}</span>${rect}</div>
      <div class="lv-sub">Suggested locators</div>
      <ul class="lv-locators">${locators}</ul>
      <div class="lv-sub">Attributes</div>
      <table class="lv-attrs">${rows}</table>
    </div>`;
}

/**
 * Build the interactive live-view HTML.
 *
 * @param {Object} options
 * @param {string} [options.xml]         raw Appium page source (parsed if `parsed` absent)
 * @param {Object} [options.parsed]      result of `parseSource`, to avoid re-parsing
 * @param {string} options.screenshot    base64 PNG or a full `data:` URI
 * @param {string} [options.title]       document/header title
 * @param {string} [options.platformName]
 * @param {string} [options.selectedPath] `node.path` to pre-select (e.g. the element a step acted on)
 * @returns {string} a complete, standalone HTML document
 */
export function buildLiveViewHtml(options = {}) {
  const parsed = options.parsed || parseSource(options.xml || '');
  const { nodes, extents } = parsed;
  const drawable = nodes.filter((n) => n.rect && n.rect.w > 0 && n.rect.h > 0);
  const shot = normalizeScreenshot(options.screenshot);
  const title = options.title || 'Appium live view';
  const selected = options.selectedPath
    ? drawable.find((n) => n.path === options.selectedPath)
    : null;

  const radios = [
    `<input type="radio" name="lv-sel" id="lv-none" class="lv-r"${selected ? '' : ' checked'}>`,
    ...drawable.map(
      (n) =>
        `<input type="radio" name="lv-sel" id="lv-r-${n.index}" class="lv-r"${
          selected && selected.index === n.index ? ' checked' : ''
        }>`,
    ),
  ].join('\n');

  const overlays = drawable
    .map((n) => {
      const r = n.rect;
      const style =
        `left:${pct(r.x1, extents.width)};top:${pct(r.y1, extents.height)};` +
        `width:${pct(r.w, extents.width)};height:${pct(r.h, extents.height)}`;
      return `<label class="lv-el lv-el-${n.index}" for="lv-r-${n.index}" style="${style}">` +
        `<span class="lv-tip">${escapeHtml(tipLabel(n))}</span></label>`;
    })
    .join('\n');

  const panels = drawable.map(renderPanel).join('\n');

  // Per-element selection rules: reveal the matching panel and pin the overlay.
  const selectionCss = drawable
    .map(
      (n) =>
        `#lv-r-${n.index}:checked~.lv-main .lv-panel-${n.index}{display:block}` +
        `#lv-r-${n.index}:checked~.lv-main .lv-el-${n.index}{outline:2px solid #e5484d;background:rgba(229,72,77,.16);z-index:9999}`,
    )
    .join('');

  const meta = [
    options.platformName ? escapeHtml(options.platformName) : null,
    `${drawable.length} elements`,
    extents.width && extents.height ? `${extents.width}×${extents.height}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<!-- Styles live in <body>, not <head>: when this document is shown inline as an
     Allure attachment it is sanitized with DOMPurify's default (body-only)
     config, which discards <head>. Keeping the stylesheet in <body> lets the
     live view render correctly both inline and standalone. -->
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c1c1e;background:#f5f5f7}
.lv-r{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
.lv-head{display:flex;gap:12px;align-items:baseline;padding:10px 14px;border-bottom:1px solid rgba(0,0,0,.1)}
.lv-head h1{font-size:14px;margin:0;font-weight:600}
.lv-head .lv-meta{color:#6e6e73;font-size:12px}
.lv-head .lv-filter{margin-left:auto}
.lv-head input[type=search]{font:inherit;padding:4px 8px;border:1px solid rgba(0,0,0,.2);border-radius:6px;background:#fff;color:inherit}
.lv-main{display:flex;gap:16px;align-items:flex-start;padding:14px;flex-wrap:wrap}
.lv-stage{position:relative;flex:0 0 auto;width:min(420px,92vw);aspect-ratio:${extents.width || 9} / ${extents.height || 16};background:#000;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.2)}
.lv-shot{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
.lv-el{position:absolute;cursor:pointer;outline:1px solid rgba(59,130,246,.001)}
.lv-el:hover{outline:2px solid #3b82f6;background:rgba(59,130,246,.14);z-index:5000}
.lv-tip{display:none;position:absolute;left:0;bottom:100%;margin-bottom:2px;max-width:260px;padding:2px 6px;border-radius:5px;background:#111;color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:6000}
.lv-el:hover>.lv-tip{display:block}
.lv-el.lv-dim{display:none}
.lv-side{flex:1 1 320px;min-width:280px;max-height:78vh;overflow:auto}
.lv-panel{display:none;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px;padding:12px}
.lv-panel-none{display:block;color:#6e6e73}
.lv-panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}
.lv-tag{font-weight:600;font-size:14px;word-break:break-all}
.lv-rect{color:#6e6e73;font-size:12px;white-space:nowrap}
.lv-sub{margin:12px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8a8a8e}
.lv-locators{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.lv-locators li{background:#f5f5f7;border-radius:7px;padding:6px 8px}
.lv-loc-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.lv-loc-type{font-size:11px;color:#8a8a8e;text-transform:uppercase;letter-spacing:.03em}
.lv-loc-value{display:block;margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
.lv-copy{font:inherit;font-size:11px;border:1px solid rgba(0,0,0,.2);background:#fff;color:inherit;border-radius:5px;padding:1px 7px;cursor:pointer}
.lv-copy:hover{background:#eee}
.lv-attrs{width:100%;border-collapse:collapse}
.lv-attrs th{text-align:left;vertical-align:top;color:#6e6e73;font-weight:500;padding:2px 8px 2px 0;white-space:nowrap}
.lv-attrs td{vertical-align:top;padding:2px 0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
${selectionCss}
@media (prefers-color-scheme:dark){
body{color:#e5e5e7;background:#1c1c1e}
.lv-panel{background:#2c2c2e;border-color:rgba(255,255,255,.12)}
.lv-locators li{background:#3a3a3c}
.lv-copy,.lv-head input[type=search]{background:#3a3a3c;border-color:rgba(255,255,255,.2)}
.lv-copy:hover{background:#48484a}
}
</style>
${radios}
<div class="lv-head">
  <h1>${escapeHtml(title)}</h1>
  <span class="lv-meta">${meta}</span>
  <span class="lv-filter"><input type="search" id="lv-filter" placeholder="filter elements…" autocomplete="off"></span>
</div>
<div class="lv-main">
  <div class="lv-stage">
    ${shot ? `<img class="lv-shot" src="${shot}" alt="screenshot">` : ''}
    ${overlays}
  </div>
  <div class="lv-side">
    <div class="lv-panel lv-panel-none">Hover an element to preview it; click to pin its attributes and locators here.</div>
    ${panels}
  </div>
</div>
<script>
/* Progressive enhancement — runs only when opened standalone (Allure's inline
   iframe strips this). Everything above already works without it. */
(function(){
  document.addEventListener("click",function(e){
    var b=e.target.closest(".lv-copy");
    if(!b)return;
    var v=b.getAttribute("data-copy")||"";
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(v).then(function(){
        var t=b.textContent;b.textContent="copied";setTimeout(function(){b.textContent=t;},900);
      });
    }
  });
  var f=document.getElementById("lv-filter");
  if(f){f.addEventListener("input",function(){
    var q=f.value.trim().toLowerCase();
    document.querySelectorAll(".lv-el").forEach(function(el){
      if(!q){el.classList.remove("lv-dim");return;}
      var tip=el.querySelector(".lv-tip");
      var hit=tip&&tip.textContent.toLowerCase().indexOf(q)!==-1;
      el.classList.toggle("lv-dim",!hit);
    });
  });}
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){var n=document.getElementById("lv-none");if(n)n.checked=true;}
  });
})();
</script>
</body>
</html>`;
}
