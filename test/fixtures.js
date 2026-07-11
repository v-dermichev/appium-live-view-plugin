// Sample Appium page sources for tests and the demo generator.

// Android (uiautomator2): `bounds="[x1,y1][x2,y2]"`. The title's `text` carries a
// literal `>` inside the quoted value plus an `&amp;` entity — exercising the
// quote-aware scanner and entity decoding.
export const ANDROID_XML = `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <android.widget.FrameLayout package="com.example.app" bounds="[0,0][1080,2400]">
    <android.widget.TextView resource-id="com.example.app:id/title" text="A > B &amp; C" bounds="[40,120][1040,220]"/>
    <android.widget.LinearLayout bounds="[0,300][1080,900]">
      <android.widget.EditText resource-id="com.example.app:id/username" text="" content-desc="Username field" bounds="[60,360][1020,470]"/>
      <android.widget.EditText resource-id="com.example.app:id/password" password="true" bounds="[60,520][1020,630]"/>
    </android.widget.LinearLayout>
    <android.widget.Button resource-id="com.example.app:id/login" content-desc="Log in" text="LOG IN" bounds="[60,1000][1020,1140]"/>
  </android.widget.FrameLayout>
</hierarchy>`;

// iOS (XCUITest): `x`/`y`/`width`/`height` in points. The horizontal scroll view
// holds an off-screen cell (x2=800, beyond the 390-wide app) — iOS reports such
// bounds, so the coordinate space must come from the app box, not the max extent.
export const IOS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" x="0" y="0" width="390" height="844">
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Welcome" name="title" x="24" y="80" width="342" height="34"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="ghost" label="Ghost" visible="false" x="24" y="120" width="200" height="24"/>
    <XCUIElementTypeOther type="XCUIElementTypeOther" name="wrapper" accessible="false" visible="true" x="0" y="160" width="390" height="120"/>
    <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="username" label="Username" x="24" y="200" width="342" height="44"/>
    <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" name="carousel" x="0" y="300" width="390" height="200">
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="offscreen-card" x="420" y="320" width="380" height="160"/>
    </XCUIElementTypeScrollView>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="login" label="Log in" x="24" y="740" width="342" height="48"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

// 1x1 transparent PNG — stands in for a device screenshot in tests.
export const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
