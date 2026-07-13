import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from appium_live_view import (  # noqa: E402
    WEB_SNAPSHOT_JS,
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
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="ghost" label="Ghost" visible="false" x="24" y="120" width="200" height="24"/>
    <XCUIElementTypeOther type="XCUIElementTypeOther" name="wrapper" accessible="false" visible="true" x="0" y="160" width="390" height="120"/>
    <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" name="carousel" x="0" y="300" width="390" height="200">
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="offscreen-card" x="420" y="320" width="380" height="160"/>
    </XCUIElementTypeScrollView>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="login" label="Log in" x="24" y="740" width="342" height="48"/>
  </XCUIElementTypeApplication>
</AppiumAUT>"""

WEB_XML = """<webview bounds="[0,0][390,700]">
  <html bounds="[0,0][390,700]">
    <body bounds="[0,0][390,700]">
      <button id="go" class="btn primary" aria-label="Go now" text="Go" bounds="[20,100][85,142]"></button>
      <input name="q" placeholder="Search" bounds="[20,160][370,190]"></input>
    </body>
  </html>
</webview>"""

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


def test_not_visible_or_not_accessible_elements_get_ghost_overlay():
    import re

    parsed = parse_source(IOS_XML)
    html = build_live_view_html(parsed=parsed, screenshot=PNG_1x1, platform_name="iOS")
    for name in ("ghost", "wrapper"):  # visible="false" and accessible="false"
        n = next(x for x in parsed["nodes"] if x.attributes.get("name") == name)
        assert n.rect  # has on-screen bounds
        assert f'class="lv-node lv-node-{n.index}"' in html  # in the tree
        assert f"lv-panel lv-panel-{n.index}" in html  # has a panel
        assert f'lv-el lv-el-{n.index}"' not in html  # no drawable overlay
        assert f'lv-ghost lv-el-{n.index}"' in html  # ghost overlay
        assert re.search(rf"#lv-r-{n.index}:checked~[^}}]*\.lv-el-{n.index}\{{[^}}]*dotted", html)


def test_fully_on_screen_z_index_above_partial():
    import re

    parsed = parse_source(IOS_XML)
    html = build_live_view_html(parsed=parsed, screenshot=PNG_1x1)

    def z_of(idx):
        return int(re.search(rf'lv-el-{idx}"[^>]*z-index:(\d+)', html).group(1))

    on_screen = next(n for n in parsed["nodes"] if n.attributes.get("name") == "login")  # within 390x844
    partial = next(n for n in parsed["nodes"] if n.attributes.get("name") == "offscreen-card")  # x2=800
    assert z_of(on_screen.index) >= 1000000
    assert z_of(partial.index) < 1000000


def test_smaller_element_above_larger_at_same_depth():
    import re

    parsed = parse_source(IOS_XML)
    html = build_live_view_html(parsed=parsed, screenshot=PNG_1x1)

    def z_of(idx):
        return int(re.search(rf'lv-el-{idx}"[^>]*z-index:(\d+)', html).group(1))

    ghost = next(n for n in parsed["nodes"] if n.attributes.get("name") == "ghost")  # 200×24
    wrapper = next(n for n in parsed["nodes"] if n.attributes.get("name") == "wrapper")  # 390×120, same depth, larger
    assert ghost.depth == wrapper.depth
    assert z_of(ghost.index) > z_of(wrapper.index)  # smaller on top


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


def test_web_context_css_dom_locators_and_overlays():
    parsed = parse_source(WEB_XML)
    assert parsed["root"].tag_name == "webview"
    go = next(n for n in parsed["nodes"] if n.attributes.get("id") == "go")
    locs = [l["value"] for l in suggest_locators(go, is_web=True)]
    assert "#go" in locs
    assert "button.btn.primary" in locs
    assert 'button[aria-label="Go now"]' in locs
    assert any(v.startswith("//button[normalize-space()='Go'") for v in locs)
    assert "/html/body/button" in locs  # webview wrapper stripped
    html = build_live_view_html(parsed=parsed, screenshot=PNG_1x1)  # auto-detects web
    assert "#go" in html
    assert f'lv-el lv-el-{go.index}"' in html


def test_web_coordinate_space_from_screenshot_not_innerheight():
    import struct

    def fake_png(w, h):
        b = bytearray(24)
        struct.pack_into(">I", b, 0, 0x89504E47)  # PNG signature start
        struct.pack_into(">I", b, 16, w)
        struct.pack_into(">I", b, 20, h)
        return "data:image/png;base64," + base64.b64encode(bytes(b)).decode()

    # Snapshot innerHeight=500, but screenshot 720x1200 px @ dpr 2 => 360x600 css.
    xml = (
        '<webview dpr="2" bounds="[0,0][360,500]">'
        '<html bounds="[0,0][360,500]"><body bounds="[0,0][360,500]">'
        '<button id="b" bounds="[0,300][360,360]"></button>'
        "</body></html></webview>"
    )
    html = build_live_view_html(xml, fake_png(720, 1200), context="web")
    assert "aspect-ratio:360 / 600" in html  # from screenshot css size
    assert "top:50.0000%" in html  # button y1=300 of 600, not 300/500=60%
    assert "top:60.0000%" not in html


def test_web_webview_rect_offsets_overlays_full_device():
    import struct

    def fake_png(w, h):
        b = bytearray(24)
        struct.pack_into(">I", b, 0, 0x89504E47)
        struct.pack_into(">I", b, 16, w)
        struct.pack_into(">I", b, 20, h)
        return "data:image/png;base64," + base64.b64encode(bytes(b)).decode()

    xml = (
        '<webview dpr="1" bounds="[0,0][393,659]" screen="[0,0][393,852]">'
        '<html bounds="[0,0][393,659]"><body bounds="[0,0][393,659]">'
        '<button id="b" bounds="[0,100][393,140]"></button>'
        "</body></html></webview>"
    )
    png = fake_png(393, 852)
    off = build_live_view_html(xml, png, context="web", webview_rect={"x": 0, "y": 59})
    assert "top:18.6620%" in off  # (100+59)/852
    no_off = build_live_view_html(xml, png, context="web")
    assert "top:11.7371%" in no_off  # 100/852, no auto-offset


def test_landscape_screenshot_gets_stacked_layout_class():
    import struct

    def fake_png(w, h):
        b = bytearray(24)
        struct.pack_into(">I", b, 0, 0x89504E47)
        struct.pack_into(">I", b, 16, w)
        struct.pack_into(">I", b, 20, h)
        return "data:image/png;base64," + base64.b64encode(bytes(b)).decode()

    wide = build_live_view_html(
        '<webview dpr="1" bounds="[0,0][900,500]"><html bounds="[0,0][900,500]"></html></webview>',
        fake_png(900, 500), context="web",
    )
    assert 'class="lv-root lv-landscape"' in wide
    tall = build_live_view_html(
        '<webview dpr="1" bounds="[0,0][500,900]"><html bounds="[0,0][500,900]"></html></webview>',
        fake_png(500, 900), context="web",
    )
    assert 'class="lv-root"' in tall
    assert 'class="lv-root lv-landscape"' not in tall


def test_locator_tester_css_web_only_and_hint_above_stage():
    import re

    web = build_live_view_html(WEB_XML, PNG_1x1)
    assert 'id="lv-find"' in web
    assert '<option value="css">CSS</option><option value="xpath">XPath</option>' in web
    assert re.search(r'<div class="lv-stagecol">\s*<div class="lv-hint">', web)
    native = build_live_view_html(ANDROID_XML, PNG_1x1)
    assert '<option value="css">' not in native
    assert '<select id="lv-strat" class="lv-strat" aria-label="Locator strategy"><option value="xpath">XPath</option>' in native


def test_web_snapshot_js_matches_and_is_a_script():
    assert WEB_SNAPSHOT_JS.startswith("return (")
    assert "getBoundingClientRect" in WEB_SNAPSHOT_JS
    assert "bounds=" in WEB_SNAPSHOT_JS
    assert "dpr=" in WEB_SNAPSHOT_JS
    assert "screen=" in WEB_SNAPSHOT_JS


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
    # the "hover an element" placeholder is hidden unless nothing is selected
    assert ".lv-hint{display:none" in html
    assert "#lv-none:checked~.lv-main .lv-hint{display:block}" in html
