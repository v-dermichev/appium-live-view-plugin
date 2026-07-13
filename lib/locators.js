// Suggest locators for a parsed node, mirroring the "find by" hints Appium
// Inspector shows in its element-detail panel. Kept intentionally light: the
// goal is copy-pasteable starting points, not guaranteed-unique selectors.

const ANDROID_ID = 'resource-id';
const ANDROID_DESC = 'content-desc';
const ANDROID_TEXT = 'text';
const IOS_NAME = 'name';
const IOS_LABEL = 'label';
const IOS_VALUE = 'value';

function xpathLiteral(value) {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  // Value contains both quote kinds — assemble with concat().
  const parts = value.split("'").map((p) => `'${p}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

/**
 * Build the absolute XPath of a node from its ancestor chain, using
 * position predicates among same-tag siblings (`/a.b.Foo[2]/...`).
 */
export function absoluteXPath(node) {
  const segments = [];
  let current = node;
  while (current && current.parent) {
    const sameTag = current.parent.children.filter((c) => c.tagName === current.tagName);
    const segment =
      sameTag.length > 1 ? `${current.tagName}[${sameTag.indexOf(current) + 1}]` : current.tagName;
    segments.unshift(segment);
    current = current.parent;
  }
  // `current` is now the root element; include it without a predicate.
  if (current) {
    segments.unshift(current.tagName);
  }
  return `/${segments.join('/')}`;
}

/**
 * Return an ordered list of `{type, using, value}` locator suggestions, most
 * specific first. `using` values match the standard Appium locator strategies.
 */
export function suggestLocators(node, isWeb = false) {
  const a = node.attributes || {};
  const out = [];
  const seen = new Set();
  const add = (type, using, value) => {
    if (!value) {
      return;
    }
    const key = `${using}|${value}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({type, using, value});
  };

  if (isWeb) {
    return webLocators(node, a, add, out);
  }

  // Accessibility id — the most portable, cross-platform strategy.
  add('accessibility id', 'accessibility id', a[ANDROID_DESC] || a[IOS_NAME]);

  // Platform resource identifiers.
  add('id', 'id', a[ANDROID_ID]);

  // Attribute-scoped XPath, cheap and often unique enough.
  if (a[ANDROID_ID]) {
    add('xpath', 'xpath', `//*[@resource-id=${xpathLiteral(a[ANDROID_ID])}]`);
  }
  if (a[ANDROID_TEXT]) {
    add('xpath', 'xpath', `//*[@text=${xpathLiteral(a[ANDROID_TEXT])}]`);
  }
  if (a[IOS_LABEL]) {
    add('xpath', 'xpath', `//${node.tagName}[@label=${xpathLiteral(a[IOS_LABEL])}]`);
  }
  if (a[IOS_VALUE]) {
    add('xpath', 'xpath', `//${node.tagName}[@value=${xpathLiteral(a[IOS_VALUE])}]`);
  }

  // Absolute XPath — always available, brittle but unambiguous.
  add('xpath (absolute)', 'xpath', absoluteXPath(node));

  return out;
}

const cssAttrValue = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const isCssIdent = (v) => /^[A-Za-z_][\w-]*$/.test(v);

// Locators for a DOM element (WebView / hybrid context): CSS selectors + DOM XPath.
function webLocators(node, a, add, out) {
  const tag = node.tagName;
  if (a.id) {
    add('css', 'css selector', isCssIdent(a.id) ? `#${a.id}` : `${tag}[id="${cssAttrValue(a.id)}"]`);
  }
  if (a.name) {
    add('css', 'css selector', `${tag}[name="${cssAttrValue(a.name)}"]`);
  }
  if (a['aria-label']) {
    add('css', 'css selector', `${tag}[aria-label="${cssAttrValue(a['aria-label'])}"]`);
  }
  if (a.class) {
    // Cap to the first few classes — utility-CSS frameworks (Tailwind &c.) put
    // dozens on an element, which makes an unwieldy, fragile selector and bloats
    // the panel; a handful is enough to suggest.
    const cls = a.class
      .trim()
      .split(/\s+/)
      .filter(isCssIdent)
      .slice(0, 3)
      .map((c) => `.${c}`)
      .join('');
    if (cls) {
      add('css', 'css selector', `${tag}${cls}`);
    }
  }
  if (a.text) {
    add('xpath', 'xpath', `//${tag}[normalize-space()=${xpathLiteral(a.text)}]`);
  }
  // Absolute XPath — drop the synthetic <webview> wrapper so it's a real DOM path.
  add('xpath (absolute)', 'xpath', absoluteXPath(node).replace(/^\/webview/, ''));
  return out;
}
