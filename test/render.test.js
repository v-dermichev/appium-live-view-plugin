import assert from 'node:assert/strict';
import { test } from 'node:test';

import { absoluteXPath, suggestLocators } from '../lib/locators.js';
import { decodeEntities, parseCoordinates, parseSource } from '../lib/parse.js';
import { buildLiveViewHtml } from '../lib/render.js';

import { ANDROID_XML, IOS_XML, PNG_1x1 } from './fixtures.js';

test('parseCoordinates reads Android bounds', () => {
  assert.deepEqual(parseCoordinates({ bounds: '[10,20][110,220]' }), {
    x1: 10,
    y1: 20,
    x2: 110,
    y2: 220,
  });
});

test('parseCoordinates reads iOS x/y/width/height', () => {
  assert.deepEqual(parseCoordinates({ x: '24', y: '80', width: '342', height: '34' }), {
    x1: 24,
    y1: 80,
    x2: 366,
    y2: 114,
  });
});

test('parseCoordinates returns null without positional data', () => {
  assert.equal(parseCoordinates({ name: 'foo' }), null);
});

test('decodeEntities handles named and numeric refs, & last', () => {
  assert.equal(decodeEntities('A &gt; B &amp; C &#65; &#x42;'), 'A > B & C A B');
});

test('scanner is quote-aware: literal > inside an attribute value', () => {
  const { nodes } = parseSource(ANDROID_XML);
  const title = nodes.find((n) => n.attributes['resource-id']?.endsWith('/title'));
  assert.ok(title, 'title node parsed');
  // The tag did not terminate at the literal ">" inside text="A > B & C".
  assert.equal(title.attributes.text, 'A > B & C');
  assert.deepEqual(title.rect, { x1: 40, y1: 120, x2: 1040, y2: 220, w: 1000, h: 100 });
});

test('parseSource computes extents from the root bounds (Android)', () => {
  const { extents, root } = parseSource(ANDROID_XML);
  assert.equal(root.tagName, 'hierarchy');
  assert.deepEqual(extents, { width: 1080, height: 2400 });
});

test('extents are the app box, not the max — iOS off-screen content ignored', () => {
  const { nodes, extents } = parseSource(IOS_XML);
  // fixture has an off-screen cell at x2=800, well beyond the 390-wide app
  assert.ok(
    nodes.some((n) => n.rect && n.rect.x2 > 390),
    'fixture has an element beyond the screen',
  );
  // coordinate space must be the screen (app box), so overlays line up with the
  // screenshot — NOT max(x2)/max(y2) which the off-screen content would inflate
  assert.deepEqual(extents, { width: 390, height: 844 });
});

test('absoluteXPath uses same-tag position predicates', () => {
  const { nodes } = parseSource(ANDROID_XML);
  const edits = nodes.filter((n) => n.tagName === 'android.widget.EditText');
  assert.equal(edits.length, 2);
  const xp = absoluteXPath(edits[1]);
  assert.match(xp, /android\.widget\.EditText\[2\]$/);
  assert.ok(xp.startsWith('/hierarchy/'));
});

test('suggestLocators prefers accessibility id and id', () => {
  const { nodes } = parseSource(ANDROID_XML);
  const login = nodes.find((n) => n.attributes['resource-id']?.endsWith('/login'));
  const locs = suggestLocators(login);
  assert.equal(locs[0].using, 'accessibility id');
  assert.equal(locs[0].value, 'Log in');
  assert.ok(locs.some((l) => l.using === 'id' && l.value === 'com.example.app:id/login'));
  assert.ok(locs.some((l) => l.value.startsWith('/hierarchy/')));
});

test('overlays cover drawable nodes; panels, radios and tree rows cover every node', () => {
  const parsed = parseSource(ANDROID_XML);
  const all = parsed.nodes;
  const drawable = all.filter((n) => n.rect && n.rect.w > 0 && n.rect.h > 0);
  assert.ok(all.length > drawable.length, 'fixture has non-drawable nodes (e.g. <hierarchy>)');
  const html = buildLiveViewHtml({ parsed, screenshot: PNG_1x1, platformName: 'Android' });

  assert.ok(html.startsWith('<!doctype html>'));
  // Overlays only for elements with bounds.
  assert.equal((html.match(/class="lv-el /g) || []).length, drawable.length);
  // Panels, selection radios and tree rows for every node — so non-drawable /
  // covered elements are still selectable via the source tree.
  assert.equal((html.match(/class="lv-panel lv-panel-\d/g) || []).length, all.length);
  assert.equal((html.match(/name="lv-sel"/g) || []).length, all.length + 1);
  assert.equal((html.match(/class="lv-node lv-node-\d/g) || []).length, all.length);
  assert.ok(html.includes(`data:image/png;base64,${PNG_1x1}`));
  assert.ok(html.includes(`${drawable.length} elements`));
});

test('visible/accessible=false: selectable, no drawable overlay, dotted ghost overlay', () => {
  const parsed = parseSource(IOS_XML);
  const html = buildLiveViewHtml({ parsed, screenshot: PNG_1x1, platformName: 'iOS' });
  for (const name of ['ghost', 'wrapper']) {
    const n = parsed.nodes.find((x) => x.attributes.name === name);
    assert.ok(n && n.rect, `${name} has on-screen bounds`);
    assert.ok(html.includes(`class="lv-node lv-node-${n.index}"`), `${name} in the source tree`);
    assert.ok(html.includes(`lv-panel lv-panel-${n.index}`), `${name} has a details panel`);
    assert.ok(!html.includes(`lv-el lv-el-${n.index}"`), `${name} has no drawable overlay`);
    assert.ok(html.includes(`lv-ghost lv-el-${n.index}"`), `${name} has a ghost overlay (dotted on select)`);
    // the dotted-on-select rule exists for it
    assert.match(html, new RegExp(`#lv-r-${n.index}:checked~[^}]*\\.lv-el-${n.index}\\{[^}]*dotted`));
  }
});

test('fully on-screen overlays get a higher z-index than partially off-screen ones', () => {
  const parsed = parseSource(IOS_XML);
  const html = buildLiveViewHtml({ parsed, screenshot: PNG_1x1 });
  const zOf = (idx) => Number(html.match(new RegExp(`lv-el-${idx}"[^>]*z-index:(\\d+)`))[1]);
  const onScreen = parsed.nodes.find((n) => n.attributes.name === 'title'); // within 390x844
  const partial = parsed.nodes.find((n) => n.attributes.name === 'offscreen-card'); // x2=800
  assert.ok(zOf(onScreen.index) >= 1000, 'fully on-screen is boosted');
  assert.ok(zOf(partial.index) < 1000, 'partially off-screen is not boosted');
});

test('non-drawable nodes get a selectable tree row + panel but no overlay', () => {
  const parsed = parseSource(ANDROID_XML);
  const hierarchy = parsed.nodes.find((n) => n.tagName === 'hierarchy');
  assert.ok(hierarchy && !hierarchy.rect, 'root <hierarchy> has no bounds');
  const html = buildLiveViewHtml({ parsed, screenshot: PNG_1x1 });
  assert.ok(html.includes(`class="lv-node lv-node-${hierarchy.index}"`), 'tree row present');
  assert.ok(html.includes(`for="lv-r-${hierarchy.index}"`), 'row selects the node radio');
  assert.ok(html.includes(`lv-panel lv-panel-${hierarchy.index}`), 'panel present');
  assert.ok(!html.includes(`lv-el lv-el-${hierarchy.index}"`), 'no overlay for a non-drawable node');
});

test('buildLiveViewHtml escapes attribute values into panels', () => {
  const html = buildLiveViewHtml({ xml: ANDROID_XML, screenshot: PNG_1x1 });
  // "A > B & C" must be HTML-escaped in the attribute table, never raw.
  assert.ok(html.includes('A &gt; B &amp; C'));
  assert.ok(!html.includes('A > B & C'));
});

test('selectedPath pre-checks the matching radio', () => {
  const parsed = parseSource(IOS_XML);
  const login = parsed.nodes.find((n) => n.attributes.name === 'login');
  const html = buildLiveViewHtml({ parsed, screenshot: PNG_1x1, selectedPath: login.path });
  assert.match(html, new RegExp(`id="lv-r-${login.index}" class="lv-r" checked`));
  assert.ok(!/id="lv-none" class="lv-r" checked/.test(html));
});

test('renders without a screenshot (source-only)', () => {
  const html = buildLiveViewHtml({ xml: IOS_XML });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!html.includes('<img class="lv-shot"'));
});
