"""appium-live-view — build a standalone, interactive HTML "live view" (Appium
Inspector-style: hover to highlight, click to inspect, source tree, XPath tester)
from a page source (XML) + screenshot, with no server or browser needed.

    from appium_live_view import build_live_view_html

    html = build_live_view_html(driver.page_source, driver.get_screenshot_as_png())
    allure.attach(html, "Live view", allure.attachment_type.HTML)
"""

from ._locators import absolute_xpath, suggest_locators
from ._parse import parse_coordinates, parse_source
from ._render import build_live_view_html

__all__ = [
    "build_live_view_html",
    "parse_source",
    "parse_coordinates",
    "suggest_locators",
    "absolute_xpath",
]

__version__ = "0.1.0"
