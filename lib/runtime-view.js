// Browser-side view builder for JS mode. In JS mode `buildLiveViewHtml` ships a
// near-empty shell (screenshot + embedded source, no per-node overlays / tree /
// panels / CSS); this function rebuilds them on load from `data-src`, so a large
// page's attachment stays small. It is NOT run in Node — it is serialized with
// Function.prototype.toString() and inlined into the attachment's <script> (for a
// standalone open) and into the Allure report patch (for inline). Authoring it as
// a real function keeps regex/string escaping sane and keeps the two injection
// sites on one source of truth. Self-contained and self-gating: it no-ops unless
// the root carries data-lv-js.
export function lvBuildView() {
  var root = document.querySelector('[data-appium-live-view][data-lv-js]');
  if (!root || root.__lvBuilt) return;
  var b64 = root.getAttribute('data-src');
  if (!b64) return;
  var xml;
  try {
    var s = atob(b64), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    xml = new TextDecoder('utf-8').decode(u);
  } catch (e) {
    return;
  }
  var doc;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return;
  } catch (e) {
    return;
  }
  root.__lvBuilt = true;
  var els = doc.getElementsByTagName('*');
  var extM = /(\d+)x(\d+)/.exec(root.getAttribute('data-ext') || '') || ['', '9', '16'];
  var EW = +extM[1], EH = +extM[2];
  var offM = (root.getAttribute('data-off') || '0,0').split(',');
  var OX = +offM[0] || 0, OY = +offM[1] || 0;
  var WEB = root.getAttribute('data-web') === '1';
  var TIP = ['resource-id', 'content-desc', 'text', 'name', 'label', 'value', 'type', 'class'];
  var IDENT = /^[A-Za-z_][\w-]*$/;

  function esc(x) {
    return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pct(p, w) {
    return w > 0 ? (p / w * 100).toFixed(4) + '%' : '0%';
  }
  function attrsOf(el) {
    var o = {}, at = el.attributes;
    for (var i = 0; i < at.length; i++) o[at[i].name] = at[i].value;
    return o;
  }
  function rectOf(a) {
    if (a.bounds) {
      var p = a.bounds.split(/[\[\],]/).filter(function (x) { return x !== ''; });
      if (p.length >= 4) {
        var x1 = +p[0], y1 = +p[1], x2 = +p[2], y2 = +p[3];
        return { x1: x1, y1: y1, x2: x2, y2: y2, w: x2 - x1, h: y2 - y1 };
      }
      return null;
    }
    if (a.x != null && a.width != null) {
      var X = +a.x, Y = +a.y, W = +a.width, H = +a.height;
      return { x1: X, y1: Y, x2: X + W, y2: Y + H, w: W, h: H };
    }
    return null;
  }
  function depthOf(el) {
    var d = 0, p = el.parentElement;
    while (p) { d++; p = p.parentElement; }
    return d;
  }
  function xlit(v) {
    if (v.indexOf("'") < 0) return "'" + v + "'";
    if (v.indexOf('"') < 0) return '"' + v + '"';
    return 'concat(' + v.split("'").map(function (p) { return "'" + p + "'"; }).join(', "\'", ') + ')';
  }
  function cssv(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  function absXpath(node) {
    var segs = [], cur = node;
    while (cur && cur.parentElement) {
      var sib = [], c;
      for (c = cur.parentElement.firstElementChild; c; c = c.nextElementSibling) {
        if (c.tagName === cur.tagName) sib.push(c);
      }
      segs.unshift(sib.length > 1 ? cur.tagName + '[' + (sib.indexOf(cur) + 1) + ']' : cur.tagName);
      cur = cur.parentElement;
    }
    if (cur) segs.unshift(cur.tagName);
    return '/' + segs.join('/');
  }
  function locators(el, a, tag) {
    var out = [], seen = {};
    function add(type, val) {
      if (!val) return;
      var k = type + '|' + val;
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ type: type, value: val });
    }
    if (WEB) {
      if (a.id) add('css', IDENT.test(a.id) ? '#' + a.id : tag + '[id="' + cssv(a.id) + '"]');
      if (a.name) add('css', tag + '[name="' + cssv(a.name) + '"]');
      if (a['aria-label']) add('css', tag + '[aria-label="' + cssv(a['aria-label']) + '"]');
      if (a['class']) {
        var cc = a['class'].trim().split(/\s+/).filter(function (c) { return IDENT.test(c); }).slice(0, 3)
          .map(function (c) { return '.' + c; }).join('');
        if (cc) add('css', tag + cc);
      }
      if (a.text) add('xpath', '//' + tag + '[normalize-space()=' + xlit(a.text) + ']');
      add('xpath (absolute)', absXpath(el).replace(/^\/webview/, ''));
    } else {
      add('accessibility id', a['content-desc'] || a.name);
      add('id', a['resource-id']);
      if (a['resource-id']) add('xpath', '//*[@resource-id=' + xlit(a['resource-id']) + ']');
      if (a.text) add('xpath', '//*[@text=' + xlit(a.text) + ']');
      if (a.label) add('xpath', '//' + tag + '[@label=' + xlit(a.label) + ']');
      if (a.value) add('xpath', '//' + tag + '[@value=' + xlit(a.value) + ']');
      add('xpath (absolute)', absXpath(el));
    }
    return out;
  }

  var N = els.length, meta = new Array(N), areas = [];
  for (var i2 = 0; i2 < N; i2++) {
    var el = els[i2], a = attrsOf(el), r = rectOf(a);
    var hasRect = !!(r && r.w > 0 && r.h > 0);
    var isBox = hasRect && a.visible !== 'false' && a.displayed !== 'false' && a.accessible !== 'false';
    meta[i2] = { el: el, a: a, r: r, hasRect: hasRect, isBox: isBox, depth: depthOf(el), tag: el.tagName };
    if (hasRect) areas.push([i2, r.w * r.h]);
  }
  areas.sort(function (x, y) { return y[1] - x[1]; });
  var rank = {};
  for (var k = 0; k < areas.length; k++) rank[areas[k][0]] = Math.min(k, 999);
  function zOf(i) {
    var m = meta[i], r = m.r;
    var on = r.x1 >= 0 && r.y1 >= 0 && r.x2 <= EW && r.y2 <= EH;
    return (on ? 1000000 : 0) + m.depth * 1000 + (rank[i] || 0);
  }
  function tip(a, tag) {
    for (var t = 0; t < TIP.length; t++) if (a[TIP[t]]) return tag + ' · ' + a[TIP[t]];
    return tag;
  }

  // Overlays into the stage.
  var ov = '';
  for (var j = 0; j < N; j++) {
    var mj = meta[j];
    if (!mj.hasRect) continue;
    var rj = mj.r;
    var st = 'left:' + pct(OX + rj.x1, EW) + ';top:' + pct(OY + rj.y1, EH) +
      ';width:' + pct(rj.w, EW) + ';height:' + pct(rj.h, EH) + ';z-index:' + zOf(j);
    if (mj.isBox) {
      ov += '<label class="lv-el lv-el-' + j + '" data-i="' + j + '" style="' + st + '"><span class="lv-tip">' +
        esc(tip(mj.a, mj.tag)) + '</span></label>';
    } else {
      ov += '<label class="lv-ghost lv-el-' + j + '" data-i="' + j + '" style="' + st + '"></label>';
    }
  }
  var stage = document.querySelector('.lv-stage');
  if (stage) stage.insertAdjacentHTML('beforeend', ov);

  // Source tree.
  var tr = '';
  for (var t2 = 0; t2 < N; t2++) {
    var mt = meta[t2], at = mt.a;
    var key = at['resource-id'] || at['content-desc'] || at.text || at.name || at.label || at.value || '';
    tr += '<div class="lv-node lv-node-' + t2 + '" data-i="' + t2 + '" style="padding-left:' + (6 + mt.depth * 13) +
      'px" title="' + esc(mt.tag) + '"><span class="lv-node-tag">' + esc(mt.tag) + '</span>' +
      (key ? ' <span class="lv-node-attr">' + esc(String(key).slice(0, 40)) + '</span>' : '') +
      (mt.isBox ? '' : ' <span class="lv-node-nobox" title="not shown on the screenshot — select here to inspect">◌</span>') +
      '</div>';
  }
  var tb = document.querySelector('.lv-tree-body');
  if (tb) tb.insertAdjacentHTML('beforeend', tr);

  // Panels are built on demand.
  var side = document.querySelector('.lv-side');
  var built = {};
  function buildPanel(i) {
    if (built[i]) return;
    built[i] = 1;
    var m = meta[i], a = m.a;
    var rows = '';
    for (var kk in a) if (a.hasOwnProperty(kk)) rows += '<tr><th>' + esc(kk) + '</th><td>' + esc(a[kk]) + '</td></tr>';
    var locs = locators(m.el, a, m.tag).map(function (l) {
      return '<li class="lv-loc"><div class="lv-loc-head"><span class="lv-loc-type">' + esc(l.type) +
        '</span></div><code class="lv-loc-value">' + esc(l.value) + '</code></li>';
    }).join('');
    var rect = m.r ? '<div class="lv-rect">x ' + m.r.x1 + ', y ' + m.r.y1 + ' · ' + m.r.w + '×' + m.r.h + '</div>' : '';
    var html = '<div class="lv-panel lv-panel-' + i + '"><div class="lv-panel-head"><span class="lv-tag">' +
      esc(m.tag) + '</span>' + rect + '</div><div class="lv-sub">Suggested locators</div><ul class="lv-locators">' +
      locs + '</ul><div class="lv-sub">Attributes</div><table class="lv-attrs">' + rows + '</table></div>';
    if (side) side.insertAdjacentHTML('beforeend', html);
  }

  var hint = document.querySelector('.lv-hint');
  var cur = -1;
  function select(i) {
    var was = document.querySelectorAll('.lv-sel');
    for (var q = 0; q < was.length; q++) was[q].classList.remove('lv-sel');
    if (i < 0 || i == null) {
      cur = -1;
      if (hint) hint.style.display = 'block';
      return;
    }
    cur = i;
    buildPanel(i);
    var ovEl = document.querySelector('.lv-el-' + i);
    if (ovEl) ovEl.classList.add('lv-sel');
    var tn = document.querySelector('.lv-node-' + i);
    if (tn) tn.classList.add('lv-sel');
    var pn = document.querySelector('.lv-panel-' + i);
    if (pn) pn.classList.add('lv-sel');
    if (hint) hint.style.display = 'none';
    var tree = document.querySelector('.lv-tree');
    if (tn && tree && getComputedStyle(tree).display !== 'none') {
      var trb = tree.getBoundingClientRect(), nr = tn.getBoundingClientRect();
      tree.scrollTop += nr.top - trb.top - tree.clientHeight / 2 + nr.height / 2;
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-i]') : null;
    if (el) select(+el.getAttribute('data-i'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var ae = document.activeElement;
      if (ae && ae.id === 'lv-find') return;
      select(-1);
    }
  });

  var ps = root.getAttribute('data-sel');
  if (ps != null && ps !== '') select(+ps);
  else select(-1);
}
