import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from appium_live_view import (  # noqa: E402
    absolute_xpath,
    build_live_view_html,
    parse_coordinates,
    parse_source,
    suggest_locators,
)

# Mirrors of the JS test fixtures (test/fixtures.js).
ANDROID_XML = """<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <android.widget.FrameLayout package="com.example.app" bounds="[0,0][1080,2400]">
    <android.widget.TextView resource-id="com.example.app:id/title" text="A > B &amp; C" bounds="[40,120][1040,220]"/>
    <android.widget.LinearLayout bounds="[0,300][1080,900]">
      <android.widget.EditText resource-id="com.example.app:id/username" text="" content-desc="Username field" bounds="[60,360][1020,470]"/>
      <android.widget.EditText resource-id="com.example.app:id/password" password="true" bounds="[60,520][1020,630]"/>
    </android.widget.LinearLayout>
    <android.widget.Button resource-id="com.example.app:id/login" content-desc="Log in" text="LOG IN" bounds="[60,1000][1020,1140]"/>
  </android.widget.FrameLayout>
</hierarchy>"""

IOS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" x="0" y="0" width="390" height="844">
    <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" name="carousel" x="0" y="300" width="390" height="200">
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="offscreen-card" x="420" y="320" width="380" height="160"/>
    </XCUIElementTypeScrollView>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="login" label="Log in" x="24" y="740" width="342" height="48"/>
  </XCUIElementTypeApplication>
</AppiumAUT>"""

PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"


def test_parse_coordinates_android_and_ios():
    assert parse_coordinates({"bounds": "[10,20][110,220]"}) == {"x1": 10, "y1": 20, "x2": 110, "y2": 220}
    assert parse_coordinates({"x": "24", "y": "80", "width": "342", "height": "34"}) == {
        "x1": 24,
        "y1": 80,
        "x2": 366,
        "y2": 114,
    }
    assert parse_coordinates({"name": "foo"}) is None


def test_quote_aware_scanner_and_entities():
    nodes = parse_source(ANDROID_XML)["nodes"]
    title = next(n for n in nodes if n.attributes.get("resource-id", "").endswith("/title"))
    # literal ">" inside text="A > B & C" must not end the tag; entity decoded
    assert title.attributes["text"] == "A > B & C"
    assert title.rect == {"x1": 40, "y1": 120, "x2": 1040, "y2": 220, "w": 1000, "h": 100}


def test_extents_and_absolute_xpath():
    parsed = parse_source(ANDROID_XML)
    assert parsed["extents"] == {"width": 1080, "height": 2400}
    assert parsed["root"].tag_name == "hierarchy"
    edits = [n for n in parsed["nodes"] if n.tag_name == "android.widget.EditText"]
    assert len(edits) == 2
    xp = absolute_xpath(edits[1])
    assert xp.startswith("/hierarchy/") and xp.endswith("android.widget.EditText[2]")


def test_ios_extents_are_app_box_not_max():
    parsed = parse_source(IOS_XML)
    # off-screen cell at x2=800, beyond the 390-wide app
    assert any(n.rect and n.rect["x2"] > 390 for n in parsed["nodes"])
    # coordinate space = the screen (app box), so overlays align with the screenshot
    assert parsed["extents"] == {"width": 390, "height": 844}


def test_suggest_locators_order():
    login = next(n for n in parse_source(ANDROID_XML)["nodes"] if n.attributes.get("resource-id", "").endswith("/login"))
    locs = suggest_locators(login)
    assert locs[0]["using"] == "accessibility id" and locs[0]["value"] == "Log in"
    assert any(l["using"] == "id" and l["value"] == "com.example.app:id/login" for l in locs)


def test_build_html_structure():
    parsed = parse_source(ANDROID_XML)
    nodes = parsed["nodes"]
    drawable = [n for n in nodes if n.rect and n.rect["w"] > 0 and n.rect["h"] > 0]
    html = build_live_view_html(ANDROID_XML, PNG_1x1, platform_name="Android")

    import re

    assert html.startswith("<!doctype html>")
    assert html.count('class="lv-el ') == len(drawable)                        # overlays: drawable only
    assert len(re.findall(r'class="lv-panel lv-panel-\d', html)) == len(nodes)  # panels: every node (excl. -none)
    assert html.count('class="lv-node lv-node-') == len(nodes)                 # tree rows: every node
    assert html.count('name="lv-sel"') == len(nodes) + 1                       # radios + "none"
    assert f"data:image/png;base64,{PNG_1x1}" in html
    # full tag name in the tree (not truncated)
    assert ">android.widget.EditText<" in html
    # marker + embedded source for the runtime / XPath tester
    assert 'data-appium-live-view="1"' in html
    assert 'data-src="' in html


def test_screenshot_accepts_bytes():
    html = build_live_view_html(IOS_XML, base64.b64decode(PNG_1x1))
    assert f"data:image/png;base64,{PNG_1x1}" in html


def test_escapes_attribute_values():
    html = build_live_view_html(ANDROID_XML, PNG_1x1)
    assert "A &gt; B &amp; C" in html
    assert "A > B & C" not in html


def test_selected_path_prechecks_radio():
    parsed = parse_source(IOS_XML)
    login = next(n for n in parsed["nodes"] if n.attributes.get("name") == "login")
    html = build_live_view_html(parsed=parsed, screenshot=PNG_1x1, selected_path=login.path)
    assert f'id="lv-r-{login.index}" class="lv-r" checked' in html
    assert 'id="lv-none" class="lv-r" checked' not in html
