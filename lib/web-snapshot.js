// A browser script that snapshots the current DOM into the same bounds-annotated
// source the native live view uses, so a WebView / hybrid context (where
// `driver.page_source` is HTML with no coordinates) can be rendered too.
//
// Run it in the webview and pass the result to buildLiveViewHtml:
//
//   const source = await driver.executeScript(WEB_SNAPSHOT_JS);
//   const shot   = await driver.getScreenshot();   // webview-viewport screenshot
//   const html   = buildLiveViewHtml({ xml: source, screenshot: shot, context: 'web' });
//
// Coordinates are getBoundingClientRect() (CSS pixels), so they line up with a
// screenshot of the web content. The root <webview> tag marks the source as web,
// so the renderer suggests CSS / DOM-XPath locators automatically.
function domSnapshot() {
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, BASE: 1, TEMPLATE: 1, BR: 1, WBR: 1 };
  var ATTRS = ["id", "name", "type", "role", "href", "src", "alt", "title", "placeholder", "aria-label"];
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function className(el) {
    var c = el.className;
    return typeof c === "string" ? c : c && c.baseVal ? c.baseVal : "";
  }
  function ser(el) {
    if (SKIP[el.tagName]) return "";
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return "";
    var r = el.getBoundingClientRect();
    var tag = el.tagName.toLowerCase();
    var a = "";
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v) a += " " + ATTRS[i] + '="' + esc(v) + '"';
    }
    var cls = className(el).trim();
    if (cls) a += ' class="' + esc(cls) + '"';
    if ((tag === "input" || tag === "textarea" || tag === "select") && el.value) a += ' value="' + esc(el.value) + '"';
    var text = "";
    var ch = el.childNodes;
    for (var j = 0; j < ch.length; j++) if (ch[j].nodeType === 3) text += ch[j].nodeValue;
    text = text.replace(/\s+/g, " ").trim();
    if (text) a += ' text="' + esc(text.slice(0, 150)) + '"';
    a += ' bounds="[' + Math.round(r.left) + "," + Math.round(r.top) + "][" + Math.round(r.right) + "," + Math.round(r.bottom) + ']"';
    var kids = "";
    for (var k = 0; k < el.children.length; k++) kids += ser(el.children[k]);
    return "<" + tag + a + ">" + kids + "</" + tag + ">";
  }
  var rootEl = document.documentElement; // <html>, so absolute XPaths are /html/body/...
  var w = Math.round(window.innerWidth);
  var h = Math.round(window.innerHeight);
  return '<?xml version="1.0" encoding="UTF-8"?><webview bounds="[0,0][' + w + "," + h + ']">' + ser(rootEl) + "</webview>";
}

// Serialized (not run in Node); executeScript wraps it in a function, so `return`
// is valid. Building it from the real function avoids string-escaping pitfalls.
export const WEB_SNAPSHOT_JS = `return (${domSnapshot.toString()})();`;
