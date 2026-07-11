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
        <li class="lv-loc" data-copy="${escapeHtml(loc.value)}" title="Click to copy">
          <div class="lv-loc-head"><span class="lv-loc-type">${escapeHtml(loc.type)}</span>
            <span class="lv-loc-hint">click to copy</span></div>
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

const xmlAttrEscape = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Serialize a parsed node tree back to XML in document order. Used to embed the
 * source for the client-side XPath tester; document order matches the overlays'
 * node indices, so an XPath match maps to its overlay by position.
 */
function serializeElement(node) {
  const attrs = Object.keys(node.attributes)
    .map((k) => ` ${k}="${xmlAttrEscape(node.attributes[k])}"`)
    .join('');
  const kids = node.children.map(serializeElement).join('');
  return `<${node.tagName}${attrs}>${kids}</${node.tagName}>`;
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
  // An element gets an overlay only if it has bounds AND is actually shown on the
  // screenshot. iOS marks occluded / not-scrolled-in elements visible="false" but
  // still reports on-screen-ish coordinates for them, which would draw phantom
  // overlays over unrelated elements. Such nodes stay selectable via the tree.
  // (Android has no `visible`; `displayed="false"` is the equivalent there.)
  const isBox = (n) =>
    n.rect &&
    n.rect.w > 0 &&
    n.rect.h > 0 &&
    n.attributes.visible !== 'false' &&
    n.attributes.displayed !== 'false';
  const drawable = nodes.filter(isBox);
  const shot = normalizeScreenshot(options.screenshot);
  const title = options.title || 'Appium live view';
  // Source embedded (base64 UTF-8) for the client-side XPath tester.
  const xmlB64 = parsed.root
    ? Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${serializeElement(parsed.root)}`, 'utf8').toString('base64')
    : '';
  const selected = options.selectedPath
    ? nodes.find((n) => n.path === options.selectedPath)
    : null;

  // Radios + panels + tree rows exist for EVERY node (not just the drawable
  // ones) so elements without bounds, or fully covered by others, are still
  // selectable via the source tree. lv-tree-toggle is a separate checkbox that
  // shows/hides that tree (pure CSS, works inline).
  const radios = [
    `<input type="checkbox" id="lv-tree-toggle" class="lv-r">`,
    `<input type="radio" name="lv-sel" id="lv-none" class="lv-r"${selected ? '' : ' checked'}>`,
    ...nodes.map(
      (n) =>
        `<input type="radio" name="lv-sel" id="lv-r-${n.index}" class="lv-r"${
          selected && selected.index === n.index ? ' checked' : ''
        }>`,
    ),
  ].join('\n');

  const overlays = drawable
    .map((n) => {
      const r = n.rect;
      // z-index follows tree depth so a deeper (inner) element always sits on
      // top of its ancestors — clicks and hover then resolve to the innermost
      // element under the pointer, and a pinned outer element never covers /
      // blocks the ones nested inside it.
      const style =
        `left:${pct(r.x1, extents.width)};top:${pct(r.y1, extents.height)};` +
        `width:${pct(r.w, extents.width)};height:${pct(r.h, extents.height)};z-index:${n.depth}`;
      return `<label class="lv-el lv-el-${n.index}" for="lv-r-${n.index}" style="${style}">` +
        `<span class="lv-tip">${escapeHtml(tipLabel(n))}</span></label>`;
    })
    .join('\n');

  const panels = nodes.map(renderPanel).join('\n');

  // Source tree: one selectable row per node, indented by depth. Selecting a row
  // checks the same radio as the overlay, so it reveals the details panel and
  // (for elements that have bounds) pins the overlay.
  const treeRows = nodes
    .map((n) => {
      // Show the FULL tag (e.g. android.widget.EditText), not a shortened one —
      // the short form is misleading when writing XPath like //android.widget.EditText.
      const tag = n.tagName;
      const a = n.attributes || {};
      const key = a['resource-id'] || a['content-desc'] || a.text || a.name || a.label || a.value || '';
      return (
        `<label class="lv-node lv-node-${n.index}" for="lv-r-${n.index}" style="padding-left:${6 + n.depth * 13}px" title="${escapeHtml(n.tagName)}">` +
        `<span class="lv-node-tag">${escapeHtml(tag)}</span>` +
        (key ? ` <span class="lv-node-attr">${escapeHtml(String(key).slice(0, 40))}</span>` : '') +
        (isBox(n) ? '' : ` <span class="lv-node-nobox" title="not shown on the screenshot — select here to inspect">◌</span>`) +
        `</label>`
      );
    })
    .join('\n');

  // Per-node selection rules: reveal the details panel, highlight the tree row,
  // and (when the node has bounds) pin its overlay.
  const selectionCss = nodes
    .map(
      (n) =>
        `#lv-r-${n.index}:checked~.lv-main .lv-panel-${n.index}{display:block}` +
        `#lv-r-${n.index}:checked~.lv-main .lv-node-${n.index}{background:rgba(229,72,77,.18);outline:1px solid rgba(229,72,77,.5)}` +
        (isBox(n)
          ? `#lv-r-${n.index}:checked~.lv-main .lv-el-${n.index}{outline:2px solid #e5484d;background:rgba(229,72,77,.16)}`
          : ''),
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
.lv-head .lv-xpath{margin-left:auto;display:flex;align-items:center;gap:8px}
.lv-head input[type=text]{font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;width:min(320px,46vw);padding:4px 8px;border:1px solid rgba(0,0,0,.2);border-radius:6px;background:#fff;color:inherit}
.lv-xpath-status{font-size:12px;white-space:nowrap;color:#8a8a8e}
.lv-xpath-status.ok{color:#16a34a}
.lv-xpath-status.warn{color:#d97706}
.lv-xpath-status.err{color:#e5484d}
.lv-head .lv-tools{display:flex;gap:6px}
.lv-btn{font:inherit;font-size:12px;padding:4px 10px;border:1px solid rgba(0,0,0,.2);border-radius:6px;background:#fff;color:inherit;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-block}
.lv-btn:hover{background:#eee}
a.lv-btn:not([href]){opacity:.5;cursor:default}
.lv-tree{display:none;flex:1 1 300px;min-width:240px;max-height:78vh;overflow:auto;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px}
#lv-tree-toggle:checked~.lv-main .lv-tree{display:block}
#lv-tree-toggle:checked~.lv-head .lv-btn-src{background:#e5e5ea;border-color:rgba(0,0,0,.4)}
.lv-tree-head{position:sticky;top:0;background:#fff;padding:7px 10px;border-bottom:1px solid rgba(0,0,0,.08);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8a8a8e}
.lv-tree-body{padding:4px 2px}
.lv-node{display:block;white-space:nowrap;padding:2px 6px;border-radius:4px;cursor:pointer;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:inherit}
.lv-node:hover{background:rgba(59,130,246,.14)}
.lv-node.lv-node-hit{background:rgba(168,85,247,.22)}
.lv-node-tag{font-weight:600}
.lv-node-attr{color:#8a8a8e}
.lv-node-nobox{color:#c0392b;opacity:.7}
.lv-main{display:flex;gap:16px;align-items:flex-start;padding:14px;flex-wrap:wrap}
.lv-stage{position:relative;flex:0 0 auto;width:min(420px,92vw);aspect-ratio:${extents.width || 9} / ${extents.height || 16};background:#000;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.2)}
.lv-shot{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;user-select:none;-webkit-user-drag:none}
/* outline-offset:-2px draws highlight borders INSIDE each element box, so
   adjacent/nested element outlines never overlap or bleed onto neighbours. */
.lv-el{position:absolute;cursor:pointer;outline:1px solid transparent;outline-offset:-2px}
.lv-el:hover{outline:2px solid #3b82f6;background:rgba(59,130,246,.14)}
.lv-el.lv-xhit{outline:2px solid #a855f7;background:rgba(168,85,247,.22);z-index:8000}
.lv-tip{display:none;position:absolute;left:0;bottom:100%;margin-bottom:2px;max-width:260px;padding:2px 6px;border-radius:5px;background:#111;color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:6000}
.lv-el:hover>.lv-tip{display:block}
.lv-side{flex:1 1 320px;min-width:280px;max-height:78vh;overflow:auto}
.lv-panel{display:none;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:10px;padding:12px}
.lv-panel-none{display:block;color:#6e6e73}
.lv-panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}
.lv-tag{font-weight:600;font-size:14px;word-break:break-all}
.lv-rect{color:#6e6e73;font-size:12px;white-space:nowrap}
.lv-sub{margin:12px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8a8a8e}
.lv-locators{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
/* The whole card is the click target (children inherit the pointer and clicks
   bubble to it), so a click anywhere copies. Feedback is a card-wide overlay,
   not a small label, so it reads no matter where you clicked. */
.lv-loc{position:relative;background:#f5f5f7;border-radius:7px;padding:6px 8px;cursor:pointer;outline:1px solid transparent;transition:background .15s,outline-color .15s}
.lv-loc:hover{outline-color:rgba(59,130,246,.5)}
.lv-loc:active{background:#e6e6ea}
.lv-loc::after{content:"Copied ✓";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff;background:rgba(22,163,74,.94);border-radius:7px;opacity:0;pointer-events:none;transition:opacity .12s}
.lv-loc.lv-copied::after{opacity:1}
.lv-loc-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.lv-loc-type{font-size:11px;color:#8a8a8e;text-transform:uppercase;letter-spacing:.03em}
.lv-loc-hint{font-size:11px;color:#8a8a8e;opacity:0;transition:opacity .15s;white-space:nowrap}
.lv-loc:hover .lv-loc-hint{opacity:.65}
.lv-loc-value{display:block;margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
/* table-layout:fixed + a fixed first-column width keeps the attribute columns
   aligned identically across every element, so they do not jump when switching. */
.lv-attrs{width:100%;border-collapse:collapse;table-layout:fixed}
.lv-attrs th{width:42%;text-align:left;vertical-align:top;color:#6e6e73;font-weight:500;padding:2px 8px 2px 0;word-break:break-word}
.lv-attrs td{vertical-align:top;padding:2px 0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
${selectionCss}
@media (prefers-color-scheme:dark){
body{color:#e5e5e7;background:#1c1c1e}
.lv-panel{background:#2c2c2e;border-color:rgba(255,255,255,.12)}
.lv-loc{background:#3a3a3c}
.lv-loc:active{background:#48484a}
.lv-head input[type=text]{background:#3a3a3c;border-color:rgba(255,255,255,.2)}
.lv-btn{background:#3a3a3c;border-color:rgba(255,255,255,.2)}
.lv-btn:hover{background:#48484a}
#lv-tree-toggle:checked~.lv-head .lv-btn-src{background:#54545a;border-color:rgba(255,255,255,.4)}
.lv-tree{background:#2c2c2e;border-color:rgba(255,255,255,.12)}
.lv-tree-head{background:#2c2c2e}
}
</style>
<!-- data-appium-live-view marks this fragment for the optional Allure report
     runtime patch; data-src carries the page source (base64 UTF-8) so the patch
     can drive the XPath tester. Both survive DOMPurify (kept data-* attrs), so
     a report-side runtime can wire interactivity even though the inline iframe
     runs no scripts of its own. -->
<div class="lv-root" data-appium-live-view="1" data-src="${xmlB64}">
${radios}
<div class="lv-head">
  <h1>${escapeHtml(title)}</h1>
  <span class="lv-meta">${meta}</span>
  ${
    nodes.length || xmlB64 || shot
      ? `<span class="lv-tools">${
          nodes.length
            ? `<label for="lv-tree-toggle" class="lv-btn lv-btn-src" title="Show the source tree — every node is selectable, including ones without bounds">Source</label>`
            : ''
        }${
          xmlB64
            ? `<a id="lv-xml" class="lv-btn" download="page-source.xml" title="Download the page source (XML). The Source tree shows it in place.">XML</a>`
            : ''
        }${
          shot
            ? `<a id="lv-img" class="lv-btn" download="screenshot" title="Download the screenshot">Image</a>`
            : ''
        }</span>`
      : ''
  }
  <span class="lv-xpath">
    <input type="text" id="lv-xpath" placeholder="Test XPath, e.g. //*[@text='OK']" autocomplete="off" spellcheck="false">
    <span class="lv-xpath-status" id="lv-xstat"></span>
  </span>
</div>
<div class="lv-main">
  <div class="lv-stage">
    ${shot ? `<img class="lv-shot" src="${shot}" alt="screenshot">` : ''}
    ${overlays}
  </div>
  <nav class="lv-tree" aria-label="Source tree">
    <div class="lv-tree-head">Source tree · ${nodes.length} nodes</div>
    <div class="lv-tree-body">${treeRows}</div>
  </nav>
  <div class="lv-side">
    <div class="lv-panel lv-panel-none">Hover an element to preview it; click to pin its attributes and locators here.</div>
    ${panels}
  </div>
</div>
</div>
<script>
/* Progressive enhancement — runs only when opened standalone (Allure's inline
   iframe strips this). Everything above already works without it. */
(function(){
  var LV_ROOT=document.querySelector("[data-appium-live-view]");
  var LV_B64=LV_ROOT?LV_ROOT.getAttribute("data-src"):null;
  function lvDecodeB64(b){if(!b)return null;var s=atob(b),a=new Uint8Array(s.length);for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return new TextDecoder("utf-8").decode(a);}
  var LV_XML=lvDecodeB64(LV_B64);
  function lvBlobFromDataUri(uri){var m=/^data:([^;,]*?)(;base64)?,([\\s\\S]*)$/.exec(uri||"");if(!m)return null;var mime=m[1]||"application/octet-stream",isB64=!!m[2],data=m[3],bytes;if(isB64){var bin=atob(data);bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);}else{bytes=new TextEncoder().encode(decodeURIComponent(data));}return new Blob([bytes],{type:mime});}
  // XML/Image download controls. Click always downloads; it never navigates —
  // viewing a blob in a new tab is blocked inside Allure's sandboxed iframe
  // (blank page), and the Source tree already shows the XML in place. The href +
  // download attr keep right-click "Save link as" working too.
  function lvWireDownload(el,blob,name){
    if(!el||!blob)return;
    var url;try{url=URL.createObjectURL(blob);}catch(e){return;}
    el.href=url;el.setAttribute("download",name);
    el.addEventListener("click",function(e){
      e.preventDefault();
      var a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    });
  }
  function lvSetLinks(){
    var ax=document.getElementById("lv-xml");
    if(ax&&LV_XML){lvWireDownload(ax,new Blob([LV_XML],{type:"application/xml"}),"page-source.xml");}
    var ai=document.getElementById("lv-img"),shot=document.querySelector(".lv-shot");
    if(ai&&shot){var blob=lvBlobFromDataUri(shot.getAttribute("src"));if(blob){var ext=/svg/.test(blob.type)?"svg":(/(png|jpe?g|webp|gif)/.exec(blob.type)||[0,"png"])[1];lvWireDownload(ai,blob,"screenshot."+ext);}}
  }
  lvSetLinks();
  function lvFallbackCopy(text){
    return new Promise(function(resolve,reject){
      try{
        var ta=document.createElement("textarea");
        ta.value=text;ta.setAttribute("readonly","");
        ta.style.position="fixed";ta.style.top="-1000px";ta.style.opacity="0";
        document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,text.length);
        var ok=document.execCommand("copy");document.body.removeChild(ta);
        ok?resolve():reject(new Error("execCommand copy rejected"));
      }catch(err){reject(err);}
    });
  }
  function lvCopy(text){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).catch(function(){return lvFallbackCopy(text);});
    }
    return lvFallbackCopy(text);
  }
  function lvSelect(li){
    var val=li.querySelector(".lv-loc-value");
    if(!val)return;
    var r=document.createRange();r.selectNodeContents(val);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
  }
  document.addEventListener("click",function(e){
    var li=e.target.closest(".lv-loc");
    if(!li)return;
    var v=li.getAttribute("data-copy")||"";
    var hint=li.querySelector(".lv-loc-hint");
    lvCopy(v).then(function(){
      li.classList.add("lv-copied");
      clearTimeout(li.__lvT);
      li.__lvT=setTimeout(function(){li.classList.remove("lv-copied");},1100);
    }).catch(function(){
      // Clipboard blocked — select the value so it can be copied manually.
      lvSelect(li);
      if(hint){hint.textContent="press ⌘/Ctrl+C";clearTimeout(li.__lvT);li.__lvT=setTimeout(function(){hint.textContent="click to copy";},1600);}
    });
  });

  // XPath tester — evaluate against the page source, highlight matches, and
  // report match count / no match / invalid XPath.
  var lvDoc=null,lvEls=null;
  if(LV_XML){
    try{
      lvDoc=new DOMParser().parseFromString(LV_XML,"application/xml");
      if(lvDoc.getElementsByTagName("parsererror").length){lvDoc=null;}
      else{lvEls=lvDoc.getElementsByTagName("*");}
    }catch(err){lvDoc=null;}
  }
  var xin=document.getElementById("lv-xpath"),xstat=document.getElementById("lv-xstat");
  function lvStat(t,cls){if(xstat){xstat.textContent=t;xstat.className="lv-xpath-status"+(cls?" "+cls:"");}}
  function lvClearHits(){var h=document.querySelectorAll(".lv-xhit,.lv-node-hit");for(var i=0;i<h.length;i++){h[i].classList.remove("lv-xhit");h[i].classList.remove("lv-node-hit");}}
  function lvRunXpath(q){
    lvClearHits();
    if(!q){lvStat("");return;}
    if(!lvDoc){lvStat("source unavailable","err");return;}
    var res;
    try{res=lvDoc.evaluate(q,lvDoc,null,7,null);}catch(err){lvStat("invalid XPath","err");return;}
    var n=res.snapshotLength;
    if(!n){lvStat("no match","warn");return;}
    var drawn=0,first=null;
    for(var i=0;i<n;i++){
      var idx=Array.prototype.indexOf.call(lvEls,res.snapshotItem(i));
      if(idx<0){continue;}
      var tn=document.querySelector(".lv-node-"+idx);if(tn){tn.classList.add("lv-node-hit");}
      var ov=document.querySelector(".lv-el-"+idx);
      if(ov){ov.classList.add("lv-xhit");drawn++;if(!first){first=ov;}}
    }
    if(first){first.scrollIntoView({block:"nearest",inline:"nearest"});}
    lvStat(n+" match"+(n===1?"":"es")+(drawn<n?" · "+drawn+" on screen":""),"ok");
  }
  if(xin){
    var xt;
    xin.addEventListener("input",function(){clearTimeout(xt);xt=setTimeout(function(){lvRunXpath(xin.value.trim());},200);});
    xin.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();lvRunXpath(xin.value.trim());}});
    if(xin.value){lvRunXpath(xin.value.trim());}
  }
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"&&document.activeElement!==xin){var n=document.getElementById("lv-none");if(n){n.checked=true;}}
  });
})();
</script>
</body>
</html>`;
}
