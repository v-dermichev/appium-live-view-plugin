"""Suggested locators for a parsed node — a port of the JS ``lib/locators.js``."""

from __future__ import annotations

from ._parse import Node

_ANDROID_ID = "resource-id"
_ANDROID_DESC = "content-desc"
_ANDROID_TEXT = "text"
_IOS_NAME = "name"
_IOS_LABEL = "label"
_IOS_VALUE = "value"


def xpath_literal(value: str) -> str:
    """Quote a value for XPath, using ``concat()`` when it has both quote kinds."""
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    sep = ', ' + '"' + "'" + '"' + ', '
    return "concat(" + sep.join(f"'{p}'" for p in value.split("'")) + ")"


def absolute_xpath(node: Node) -> str:
    """Absolute XPath using position predicates among same-tag siblings."""
    segments: list[str] = []
    current = node
    while current and current.parent:
        same = [c for c in current.parent.children if c.tag_name == current.tag_name]
        seg = f"{current.tag_name}[{same.index(current) + 1}]" if len(same) > 1 else current.tag_name
        segments.insert(0, seg)
        current = current.parent
    if current:
        segments.insert(0, current.tag_name)
    return "/" + "/".join(segments)


import re as _re

_CSS_IDENT = _re.compile(r"^[A-Za-z_][\w-]*$")


def _css_attr_value(v: str) -> str:
    return str(v).replace("\\", "\\\\").replace('"', '\\"')


def _web_locators(node: Node, a: dict, add) -> list[dict]:
    tag = node.tag_name
    if a.get("id"):
        add("css", "css selector", f"#{a['id']}" if _CSS_IDENT.match(a["id"]) else f'{tag}[id="{_css_attr_value(a["id"])}"]')
    if a.get("name"):
        add("css", "css selector", f'{tag}[name="{_css_attr_value(a["name"])}"]')
    if a.get("aria-label"):
        add("css", "css selector", f'{tag}[aria-label="{_css_attr_value(a["aria-label"])}"]')
    if a.get("class"):
        # Cap to the first few classes — utility-CSS frameworks put dozens on an
        # element, making a fragile selector and bloating the panel.
        idents = [c for c in a["class"].strip().split() if _CSS_IDENT.match(c)]
        cls = "".join(f".{c}" for c in idents[:3])
        if cls:
            add("css", "css selector", f"{tag}{cls}")
    if a.get("text"):
        add("xpath", "xpath", f"//{tag}[normalize-space()={xpath_literal(a['text'])}]")
    # absolute XPath, minus the synthetic <webview> wrapper -> a real DOM path
    add("xpath (absolute)", "xpath", _re.sub(r"^/webview", "", absolute_xpath(node)))


def suggest_locators(node: Node, is_web: bool = False) -> list[dict]:
    """Ordered ``{type, using, value}`` suggestions, most specific first.

    ``is_web`` switches to WebView / hybrid (DOM) locators: CSS selectors + DOM XPath.
    """
    a = node.attributes or {}
    out: list[dict] = []
    seen: set[str] = set()

    def add(type_: str, using: str, value) -> None:
        if not value:
            return
        key = f"{using}|{value}"
        if key in seen:
            return
        seen.add(key)
        out.append({"type": type_, "using": using, "value": value})

    if is_web:
        _web_locators(node, a, add)
        return out

    add("accessibility id", "accessibility id", a.get(_ANDROID_DESC) or a.get(_IOS_NAME))
    add("id", "id", a.get(_ANDROID_ID))
    if a.get(_ANDROID_ID):
        add("xpath", "xpath", f"//*[@resource-id={xpath_literal(a[_ANDROID_ID])}]")
    if a.get(_ANDROID_TEXT):
        add("xpath", "xpath", f"//*[@text={xpath_literal(a[_ANDROID_TEXT])}]")
    if a.get(_IOS_LABEL):
        add("xpath", "xpath", f"//{node.tag_name}[@label={xpath_literal(a[_IOS_LABEL])}]")
    if a.get(_IOS_VALUE):
        add("xpath", "xpath", f"//{node.tag_name}[@value={xpath_literal(a[_IOS_VALUE])}]")
    add("xpath (absolute)", "xpath", absolute_xpath(node))
    return out
