"""Parse an Appium page source (XML) into a flat, render-ready node list.

A port of the JS ``lib/parse.js`` — same quote-aware scanner, entity decoding
and coordinate handling, so both renderers produce equivalent output.
"""

from __future__ import annotations

import re
from typing import Iterator, Optional

_ENTITIES = {"&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&"}
_NAMED_RE = re.compile(r"&(?:lt|gt|quot|apos);")
_DEC_RE = re.compile(r"&#(\d+);")
_HEX_RE = re.compile(r"&#x([0-9a-fA-F]+);")
_ATTR_RE = re.compile(r"""([\w.\-:]+)\s*=\s*("([^"]*)"|'([^']*)')""")
_INT_RE = re.compile(r"\s*([+-]?\d+)")


def decode_entities(value: str) -> str:
    """Decode the XML entities Appium's serializers emit in attribute values."""
    value = _NAMED_RE.sub(lambda m: _ENTITIES[m.group(0)], value)
    value = _DEC_RE.sub(lambda m: chr(int(m.group(1))), value)
    value = _HEX_RE.sub(lambda m: chr(int(m.group(1), 16)), value)
    return value.replace("&amp;", "&")


def _parse_int(value) -> Optional[int]:
    """Mirror JS ``parseInt``: leading optional sign + digits, else ``None``."""
    if value is None:
        return None
    m = _INT_RE.match(str(value))
    return int(m.group(1)) if m else None


def parse_coordinates(attributes: dict) -> Optional[dict]:
    """Extract ``{x1, y1, x2, y2}`` from an element's attributes.

    Android uses ``bounds="[x1,y1][x2,y2]"``; iOS uses ``x``/``y``/``width``/
    ``height``. Returns ``None`` when there is no positional data.
    """
    bounds = attributes.get("bounds")
    if bounds:
        parts = [p for p in re.split(r"[\[\],]", bounds) if p != ""]
        nums = [_parse_int(p) for p in parts[:4]]
        if len(nums) < 4 or any(n is None for n in nums):
            return None
        x1, y1, x2, y2 = nums
        return {"x1": x1, "y1": y1, "x2": x2, "y2": y2}

    x, y = attributes.get("x"), attributes.get("y")
    if x is not None and y is not None:
        xi, yi = _parse_int(x), _parse_int(y)
        wi, hi = _parse_int(attributes.get("width")), _parse_int(attributes.get("height"))
        if None in (xi, yi, wi, hi):
            return None
        return {"x1": xi, "y1": yi, "x2": xi + wi, "y2": yi + hi}

    return None


def _parse_attributes(attr_text: str) -> dict:
    attrs: dict = {}
    for m in _ATTR_RE.finditer(attr_text):
        raw = m.group(3) if m.group(3) is not None else m.group(4)
        attrs[m.group(1)] = decode_entities(raw)
    return attrs


def _tokenize(xml: str) -> Iterator[tuple]:
    """Yield ``(kind, name, attr_text)`` tokens; quote-aware so a ``>`` inside a
    quoted attribute value does not end the tag. Skips prolog/comments/CDATA."""
    i, n = 0, len(xml)
    while i < n:
        lt = xml.find("<", i)
        if lt == -1:
            break
        if xml.startswith("<!--", lt):
            end = xml.find("-->", lt + 4)
            i = n if end == -1 else end + 3
            continue
        if xml[lt + 1 : lt + 2] in ("?", "!"):
            end = xml.find(">", lt + 1)
            i = n if end == -1 else end + 1
            continue

        j, quote = lt + 1, None
        while j < n:
            ch = xml[j]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in ('"', "'"):
                quote = ch
            elif ch == ">":
                break
            j += 1
        if j >= n:
            break

        inner = xml[lt + 1 : j].strip()
        i = j + 1
        if not inner:
            continue

        is_close = inner[0] == "/"
        is_self = inner[-1] == "/"
        if is_close:
            inner = inner[1:].strip()
        if is_self:
            inner = inner[:-1].strip()

        m = re.search(r"[\s/]", inner)
        name = inner[: m.start()] if m else inner
        attr_text = inner[m.start() :] if m else ""

        if is_close:
            yield ("close", name, "")
        elif is_self:
            yield ("self", name, attr_text)
        else:
            yield ("open", name, attr_text)


class Node:
    """A parsed element: tag, attributes, tree position and (optional) rect."""

    __slots__ = ("index", "path", "tag_name", "attributes", "depth", "parent", "children", "_child_count", "rect")

    def __init__(self, index, path, tag_name, attributes, depth, parent, rect):
        self.index = index
        self.path = path
        self.tag_name = tag_name
        self.attributes = attributes
        self.depth = depth
        self.parent = parent
        self.children: list = []
        self._child_count = 0
        self.rect = rect


def parse_source(xml: str) -> dict:
    """Parse page source into ``{"nodes", "root", "extents"}``.

    ``nodes`` is every element in document order; each has ``index``, ``path``,
    ``tag_name``, ``attributes``, ``depth``, ``parent``, ``children`` and ``rect``
    (``{x1,y1,x2,y2,w,h}`` or ``None``). ``extents`` is the largest x2/y2 seen.
    """
    nodes: list[Node] = []
    stack: list[Node] = []
    root: list = [None]

    def push(name: str, attr_text: str, has_children: bool) -> None:
        attributes = _parse_attributes(attr_text)
        parent = stack[-1] if stack else None
        sibling_index = parent._child_count if parent else 0
        if parent:
            parent._child_count += 1
        if parent is None:
            path = ""
        else:
            path = str(sibling_index) if parent.path == "" else f"{parent.path}.{sibling_index}"

        coords = parse_coordinates(attributes)
        rect = None
        if coords:
            rect = {**coords, "w": coords["x2"] - coords["x1"], "h": coords["y2"] - coords["y1"]}

        node = Node(len(nodes), path, name, attributes, len(stack), parent, rect)
        nodes.append(node)
        if parent:
            parent.children.append(node)
        elif root[0] is None:
            root[0] = node
        if has_children:
            stack.append(node)

    for kind, name, attr_text in _tokenize(xml):
        if kind == "open":
            push(name, attr_text, True)
        elif kind == "self":
            push(name, attr_text, False)
        elif kind == "close" and stack:
            stack.pop()

    width = height = 0
    for node in nodes:
        if node.rect:
            width = max(width, node.rect["x2"])
            height = max(height, node.rect["y2"])

    return {"nodes": nodes, "root": root[0], "extents": {"width": width, "height": height}}
