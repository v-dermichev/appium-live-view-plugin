import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "data-appium-live-view-runtime";

// Browser-side runtime that makes appium-live-view HTML attachments interactive
// in the report. Authored as a real function (lints as JS) — NOT run in Node; it
// is serialized with Function.prototype.toString() and inlined into the report
// index.html, where it runs in the top page.
//
// Why it's needed: Allure renders text/html attachments with DOMPurify (scripts
// stripped) inside <iframe sandbox="allow-same-origin"> (no allow-scripts), so
// the attachment's own JS never runs — hover/click-pin work (pure CSS) but copy
// and the XPath tester don't. Reaching into the iframe from the parent only works
// when the report is served (http); a single-file report opened via file:// gives
// the blob an opaque origin and blocks parent access.
//
// So instead we SWAP the sandboxed blob iframe for a srcdoc iframe that is allowed
// to run scripts: fetch the (already sanitized) attachment HTML, append our own
// interactivity <script>, and set it as srcdoc with allow-scripts. srcdoc inherits
// the parent origin, so this works for both served and file:// single-file reports,
// and the injected script runs INSIDE the iframe. Everything it needs survives
// DOMPurify: the marker, data-src (page source, base64), the stylesheet, the
// overlays, the locator cards and the locator tester input.
function liveViewRuntime() {
  // Runs INSIDE the swapped iframe (self-contained). Wires copy-on-click for
  // locator cards and the XPath tester; toggles the .lv-copied / .lv-xhit classes
  // the attachment's own stylesheet already defines.
  function interact() {
    const root = document.querySelector("[data-appium-live-view]");
    if (!root) return;

    const decodeB64 = (b) => {
      const s = atob(b);
      const a = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
      return new TextDecoder("utf-8").decode(a);
    };
    const fallbackCopy = (text) =>
      new Promise((resolve, reject) => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.top = "-1000px";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          ok ? resolve() : reject(new Error("execCommand"));
        } catch (err) {
          reject(err);
        }
      });
    const copy = (text) =>
      navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
        : fallbackCopy(text);

    document.addEventListener("click", (e) => {
      const li = e.target.closest && e.target.closest(".lv-loc");
      if (!li) return;
      const val = li.querySelector(".lv-loc-value");
      copy(val ? val.textContent : "").then(() => {
        li.classList.add("lv-copied");
        clearTimeout(li.__lvT);
        li.__lvT = setTimeout(() => li.classList.remove("lv-copied"), 1100);
      });
    });

    // On selection: the view stays put (radios are position:fixed), and the
    // picked row is centered in the source tree — scrolling only the tree.
    document.addEventListener("change", (e) => {
      if (!e.target || e.target.name !== "lv-sel" || e.target.id === "lv-none") return;
      const node = document.querySelector(".lv-node-" + e.target.id.replace("lv-r-", ""));
      const tree = document.querySelector(".lv-tree");
      if (node && tree && getComputedStyle(tree).display !== "none") {
        const tr = tree.getBoundingClientRect();
        const nr = node.getBoundingClientRect();
        tree.scrollTop += nr.top - tr.top - tree.clientHeight / 2 + nr.height / 2;
      }
    });

    // Locator tester — kept in sync with lib/render.js's runtime (the attachment's
    // own <script> is stripped inline, so this report-side copy provides it). One
    // input + a CSS/XPath dropdown, evaluated against an HTML mirror of the source
    // rooted at the page's <html> (the <webview> wrapper stripped) so the SAME
    // locators shown in the panel resolve; each mirror element carries its node
    // index (data-lvi) for highlighting.
    let xdoc = null;
    let xels = null;
    const b64 = root.getAttribute("data-src");
    if (b64) {
      try {
        xdoc = new DOMParser().parseFromString(decodeB64(b64), "application/xml");
        if (xdoc.getElementsByTagName("parsererror").length) xdoc = null;
        else xels = xdoc.getElementsByTagName("*");
      } catch (err) {
        xdoc = null;
      }
    }
    let lvEval = null;
    if (xdoc) {
      try {
        const srcRoot = xdoc.querySelector("html") || xdoc.documentElement;
        const edoc = document.implementation.createHTMLDocument("");
        const mirror = (x) => {
          const el = edoc.createElement(x.tagName);
          const k = Array.prototype.indexOf.call(xels, x);
          if (k >= 0) el.setAttribute("data-lvi", String(k));
          for (let i = 0; i < x.attributes.length; i++) {
            const a = x.attributes[i];
            if (a.name === "data-lvi") continue;
            try {
              el.setAttribute(a.name, a.value);
            } catch (e) {
              /* ignore */
            }
          }
          for (let c = x.firstElementChild; c; c = c.nextElementSibling) el.appendChild(mirror(c));
          return el;
        };
        edoc.replaceChild(mirror(srcRoot), edoc.documentElement);
        lvEval = edoc;
      } catch (err) {
        lvEval = null;
      }
    }
    const input = document.getElementById("lv-find");
    const statusEl = document.getElementById("lv-fstat");
    const stratEl = document.getElementById("lv-strat");
    const setStatus = (t, cls) => {
      if (statusEl) {
        statusEl.textContent = t;
        statusEl.className = "lv-xpath-status" + (cls ? " " + cls : "");
      }
    };
    const clearHits = () => {
      const hits = document.querySelectorAll(".lv-xhit,.lv-node-hit");
      for (let i = 0; i < hits.length; i++) {
        hits[i].classList.remove("lv-xhit");
        hits[i].classList.remove("lv-node-hit");
      }
    };
    const mark = (el) => {
      const idx = el && el.getAttribute ? el.getAttribute("data-lvi") : null;
      if (idx == null) return null;
      const tn = document.querySelector(".lv-node-" + idx);
      if (tn) tn.classList.add("lv-node-hit");
      const ov = document.querySelector(".lv-el-" + idx);
      if (ov) {
        ov.classList.add("lv-xhit");
        return ov;
      }
      return null;
    };
    const run = () => {
      clearHits();
      const q = input ? input.value.trim() : "";
      const strat = stratEl ? stratEl.value : "xpath";
      if (!q) return setStatus("");
      if (!lvEval) return setStatus("source unavailable", "err");
      const matches = [];
      if (strat === "css") {
        let res;
        try {
          res = lvEval.querySelectorAll(q);
        } catch (err) {
          return setStatus("invalid selector", "err");
        }
        for (let i = 0; i < res.length; i++) matches.push(res[i]);
      } else {
        let r;
        try {
          r = lvEval.evaluate(q, lvEval, null, 7, null);
        } catch (err) {
          return setStatus("invalid XPath", "err");
        }
        for (let j = 0; j < r.snapshotLength; j++) matches.push(r.snapshotItem(j));
      }
      const n = matches.length;
      if (!n) return setStatus("no match", "warn");
      let drawn = 0;
      let first = null;
      for (let m = 0; m < n; m++) {
        const ov = mark(matches[m]);
        if (ov) {
          drawn++;
          if (!first) first = ov;
        }
      }
      if (first) first.scrollIntoView({ block: "nearest", inline: "nearest" });
      setStatus(n + " match" + (n === 1 ? "" : "es") + (drawn < n ? " · " + drawn + " on screen" : ""), "ok");
    };
    if (input) {
      let t;
      input.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(run, 200);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          run();
        }
      });
    }
    if (stratEl) {
      stratEl.addEventListener("change", () => {
        if (input)
          input.placeholder = stratEl.value === "css" ? "Test CSS, e.g. input[name=q]" : "Test XPath, e.g. //*[@text='OK']";
        run();
      });
    }
    if (input && input.value) run();

    // Header tools: give the XML/Image links real (blob) hrefs so they behave
    // like links — click to open, Ctrl/Cmd-click for a new tab, right-click to
    // save. (The source tree toggle is pure CSS and needs no JS.)
    const srcXml = b64
      ? (() => {
          try {
            return decodeB64(b64);
          } catch (e) {
            return null;
          }
        })()
      : null;
    const blobFromDataUri = (uri) => {
      const m = /^data:([^;,]*?)(;base64)?,([\s\S]*)$/.exec(uri || "");
      if (!m) return null;
      let bytes;
      if (m[2]) {
        const bin = atob(m[3]);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
      }
      return new Blob([bytes], { type: m[1] || "application/octet-stream" });
    };
    const wireDownload = (el, blob, name) => {
      if (!el || !blob) return;
      let url;
      try {
        url = URL.createObjectURL(blob);
      } catch (e) {
        return;
      }
      el.href = url;
      el.setAttribute("download", name);
      el.addEventListener("click", (e) => {
        // Always download; never navigate. A blob opened in a new tab is blank
        // inside Allure's sandboxed iframe, and the Source tree already shows the
        // XML in place. Keeps right-click "Save link as" working too.
        e.preventDefault();
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    };
    if (srcXml) {
      wireDownload(document.getElementById("lv-xml"), new Blob([srcXml], { type: "application/xml" }), "page-source.xml");
    }
    const shot = document.querySelector(".lv-shot");
    if (shot) {
      const blob = blobFromDataUri(shot.getAttribute("src"));
      const ext = blob ? (/svg/.test(blob.type) ? "svg" : (/(png|jpe?g|webp|gif)/.exec(blob.type) || [0, "png"])[1]) : "png";
      wireDownload(document.getElementById("lv-img"), blob, "screenshot." + ext);
    }

    // Report our content height to the parent so the runtime can give THIS frame
    // a full-height view (Allure collapses html attachments to a thin strip, even
    // in fullscreen). Re-report when the layout changes (tree toggled, node picked).
    const reportHeight = () => {
      const h = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0,
      );
      try {
        parent.postMessage({ appiumLiveViewHeight: h }, "*");
      } catch (e) {
        /* ignore */
      }
    };
    setTimeout(reportHeight, 50);
    setTimeout(reportHeight, 400);
    setTimeout(reportHeight, 1200);
    window.addEventListener("resize", reportHeight);
    document.addEventListener("change", () => setTimeout(reportHeight, 60));
    document.addEventListener("click", () => setTimeout(reportHeight, 60));
    // Expanding the attachment re-lays-out the frame without a child event; a
    // ResizeObserver + visibility hook re-report so the parent can re-fit.
    document.addEventListener("visibilitychange", reportHeight);
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(reportHeight).observe(document.documentElement);
      } catch (e) {
        /* ignore */
      }
    }
  }

  // Build the script tag injected into the srcdoc. The opening/closing tags are
  // split across string concatenations so this function's OWN source contains no
  // literal script-end-tag — otherwise it would close the runtime's own inlined
  // script tag in index.html when serialized. (Do not write the tag out in this
  // comment either, for the same reason.)
  const injectedScript = "<scr" + "ipt>(" + interact.toString() + ")();</scr" + "ipt>";

  // Allure sizes html-attachment iframes with `flex:1;min-height:0`, collapsing
  // them to a thin strip (even in fullscreen). For OUR frames only, we override
  // that: when a frame reports its content height, give it that exact height and
  // stop its ancestors from clipping / capping it. Other attachments are untouched.
  const lvFrames = [];
  function fitFrame(frame, h) {
    const px = Math.max(320, Math.min(h || 0, 20000));
    frame.style.flex = "none";
    frame.style.minHeight = px + "px";
    frame.style.height = px + "px";
    // Grow ONLY the collapsed wrappers between the frame and the first ancestor
    // that is already tall enough (the report's own scroll container). We do NOT
    // touch overflow or the scroll container — doing so pulled the report's logo /
    // footer into the frame. min-height alone lets the wrappers contain the frame.
    let el = frame.parentElement;
    let n = 0;
    while (el && el !== document.body && el !== document.documentElement && n < 12) {
      if (Math.round(el.getBoundingClientRect().height) >= px) break;
      el.style.minHeight = px + "px";
      el = el.parentElement;
      n++;
    }
  }
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data.appiumLiveViewHeight !== "number") return;
    for (let i = 0; i < lvFrames.length; i++) {
      if (lvFrames[i].contentWindow === e.source) {
        lvFrames[i].__lvHeight = e.data.appiumLiveViewHeight;
        fitFrame(lvFrames[i], e.data.appiumLiveViewHeight);
        break;
      }
    }
  });
  // Allure re-applies its own iframe sizing when an attachment is expanded or
  // re-rendered, collapsing our frame back to the thin default strip. Re-assert
  // the fit from the last reported height whenever a frame is shorter than it —
  // this is what makes "expand" reliably show full height instead of the preview.
  function refit() {
    for (let i = 0; i < lvFrames.length; i++) {
      const f = lvFrames[i];
      if (!f.__lvHeight || !f.isConnected) continue;
      if (Math.round(f.getBoundingClientRect().height) < f.__lvHeight - 4) {
        fitFrame(f, f.__lvHeight);
      }
    }
  }
  setInterval(refit, 400);
  window.addEventListener("resize", refit);

  function enhance(frame) {
    if (frame.__lvEnhanced) return;
    const src = frame.getAttribute("src");
    if (!src || src.indexOf("blob:") !== 0) return;
    frame.__lvEnhanced = true;
    fetch(src)
      .then((r) => r.text())
      .then((html) => {
        if (html.indexOf("data-appium-live-view") < 0) {
          frame.__lvEnhanced = false; // not one of ours
          return;
        }
        frame.removeAttribute("src");
        // allow-downloads / allow-popups so the "Save image" download and the
        // "View XML" new-tab open work from inside the sandboxed iframe.
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
        frame.srcdoc = html + injectedScript;
        if (lvFrames.indexOf(frame) < 0) lvFrames.push(frame);
      })
      .catch(() => {
        frame.__lvEnhanced = false;
      });
  }

  function scan() {
    const frames = document.querySelectorAll("iframe");
    for (let i = 0; i < frames.length; i++) enhance(frames[i]);
  }

  // Attachments render (and re-render on theme change) after navigation, so rescan
  // on DOM mutations, iframe loads, and a slow interval as a backstop.
  new MutationObserver(scan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  document.addEventListener(
    "load",
    (e) => {
      if (e.target && e.target.tagName === "IFRAME") scan();
    },
    true,
  );
  setInterval(scan, 700);
  scan();
}

// Inlines liveViewRuntime() into <body> as a self-invoking script. Idempotent via
// a marker attribute; emits no separate asset file.
export default function makeLiveViewInteractable({ outDir }) {
  const index = join(outDir, "index.html");
  const html = readFileSync(index, "utf8");
  if (html.includes(MARKER)) return;
  const tag = `<script ${MARKER}>(${liveViewRuntime.toString()})();</script>`;
  writeFileSync(index, html.replace("</body>", `    ${tag}\n</body>`));
}
