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


def suggest_locators(node: Node) -> list[dict]:
    """Ordered ``{type, using, value}`` suggestions, most specific first."""
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
