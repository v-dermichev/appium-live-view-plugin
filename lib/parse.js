// Parse an Appium page source (XML) into a flat, render-ready node list.
//
// This is the data half of Appium Inspector's "live view": the mapping from the
// XML hierarchy to on-screen rectangles. The logic mirrors appium-inspector's
// `utils/source-parsing.js` (xmlToJSON) and `utils/other.js` (parseCoordinates),
// reimplemented without a DOM so the same code runs both on the Appium server
// (Node) and inside the rendered attachment (browser).

const XML_ENTITIES = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

/**
 * Decode the XML entities Appium's serializers emit inside attribute values.
 * `&amp;` is applied last so decoded content is never re-decoded.
 */
export function decodeEntities(value) {
  return value
    .replace(/&(?:lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m])
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

const ATTR_RE = /([\w.\-:]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttributes(attrText) {
  const attributes = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(attrText)) !== null) {
    const rawValue = match[3] !== undefined ? match[3] : match[4];
    attributes[match[1]] = decodeEntities(rawValue);
  }
  return attributes;
}

/**
 * Extract an element's rectangle from its attributes.
 *
 * Two coordinate encodings appear in the wild:
 *   - Android (uiautomator2): `bounds="[x1,y1][x2,y2]"`
 *   - iOS (XCUITest) / others: `x`, `y`, `width`, `height`
 *
 * Returns `null` when the element carries no positional data (e.g. the
 * `<hierarchy>` / `<AppiumAUT>` wrappers), so callers can skip drawing it.
 */
export function parseCoordinates(attributes = {}) {
  const {bounds, x, y, width, height} = attributes;

  if (bounds) {
    const parts = bounds.split(/\[|\]|,/).filter((s) => s !== '');
    const [x1, y1, x2, y2] = parts.map((v) => parseInt(v, 10));
    if ([x1, y1, x2, y2].some((n) => Number.isNaN(n))) {
      return null;
    }
    return {x1, y1, x2, y2};
  }

  if (x !== undefined && y !== undefined) {
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    const wi = parseInt(width, 10);
    const hi = parseInt(height, 10);
    if ([xi, yi, wi, hi].some((n) => Number.isNaN(n))) {
      return null;
    }
    return {x1: xi, y1: yi, x2: xi + wi, y2: yi + hi};
  }

  return null;
}

/**
 * Walk the raw XML string and emit tag tokens. The scanner is quote-aware: a
 * `>` inside a quoted attribute value does not terminate the tag, which a naive
 * regex would get wrong for attributes like `text="a > b"`.
 *
 * Yields `{type: 'open'|'close'|'self', name, attrText}`; comments, the XML
 * prolog, DOCTYPE and CDATA markers are skipped.
 */
function* tokenize(xml) {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      break;
    }

    // Skip <?xml?>, <!-- -->, <!DOCTYPE>, <![CDATA[]]> — none carry elements.
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt + 1);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Scan to the tag-closing '>' that is not inside a quoted attribute value.
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    if (j >= n) {
      break;
    }

    let inner = xml.slice(lt + 1, j).trim();
    i = j + 1;
    if (!inner) {
      continue;
    }

    const isClose = inner[0] === '/';
    const isSelf = inner[inner.length - 1] === '/';
    if (isClose) {
      inner = inner.slice(1).trim();
    }
    if (isSelf) {
      inner = inner.slice(0, -1).trim();
    }

    const nameEnd = inner.search(/[\s/]/);
    const name = nameEnd === -1 ? inner : inner.slice(0, nameEnd);
    const attrText = nameEnd === -1 ? '' : inner.slice(nameEnd);

    if (isClose) {
      yield {type: 'close', name, attrText: ''};
    } else if (isSelf) {
      yield {type: 'self', name, attrText};
    } else {
      yield {type: 'open', name, attrText};
    }
  }
}

/**
 * Parse Appium page source into a flat list of nodes in document order.
 *
 * Each node: `{ index, path, tagName, attributes, depth, parent, rect }` where
 * `rect` is `{x1,y1,x2,y2,w,h}` or `null`. `path` is the dot-separated child
 * index chain used by Appium Inspector (root = "", first child = "0", ...).
 *
 * Also returns the source coordinate extents `{width, height}` (the largest
 * `x2`/`y2` seen), which define the space that overlays are positioned within.
 */
export function parseSource(xml) {
  const nodes = [];
  const stack = [];
  let root = null;

  const push = (name, attrText, hasChildren) => {
    const attributes = parseAttributes(attrText);
    const parent = stack[stack.length - 1] || null;
    const siblingIndex = parent ? parent.childCount++ : 0;
    const path = parent ? (parent.path === '' ? String(siblingIndex) : `${parent.path}.${siblingIndex}`) : '';
    const rect = parseCoordinates(attributes);
    const node = {
      index: nodes.length,
      path,
      tagName: name,
      attributes,
      depth: stack.length,
      parent,
      childCount: 0,
      children: [],
      rect: rect ? {...rect, w: rect.x2 - rect.x1, h: rect.y2 - rect.y1} : null,
    };
    nodes.push(node);
    if (parent) {
      parent.children.push(node);
    } else {
      root ||= node;
    }
    if (hasChildren) {
      stack.push(node);
    }
    return node;
  };

  for (const token of tokenize(xml)) {
    if (token.type === 'open') {
      push(token.name, token.attrText, true);
    } else if (token.type === 'self') {
      push(token.name, token.attrText, false);
    } else if (token.type === 'close') {
      stack.pop();
    }
  }

  let width = 0;
  let height = 0;
  for (const node of nodes) {
    if (node.rect) {
      width = Math.max(width, node.rect.x2);
      height = Math.max(height, node.rect.y2);
    }
  }

  return {nodes, root, extents: {width, height}};
}
