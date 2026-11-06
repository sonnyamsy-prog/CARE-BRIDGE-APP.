# CareBridge — new icon

The teal tile with a plain white plus has been replaced with your CareBridge wordmark
(hospital cross, bridge arc, heart, "Support beyond discharge").

This updates the browser tab icon, the phone home-screen icon, and the installed
desktop app icon.

## Files to upload (7)

| File | What it is |
|---|---|
| `index.html` | Build 9, with the icon links changed to the new files |
| `manifest.webmanifest` | PWA manifest pointing at the new icons |
| `sw.js` | Service worker, cache bumped to `carebridge-v7` (required, or phones keep the old icon) |
| `icon-192-v2.png` | Standard icon, 192x192 |
| `icon-512-v2.png` | Standard icon, 512x512 |
| `icon-maskable-192-v2.png` | Padded version for Android's round/squircle mask |
| `icon-maskable-512-v2.png` | Padded version for Android's round/squircle mask |

`CareBridge.ico` is **not uploaded** — it is only for the optional Windows shortcut step below.

Keep the file names exactly as they are. The `-v2` suffix is deliberate: it makes
Chrome and Android fetch the new image instead of reusing the cached old one.

## 1. Deploy

Use the same route you used for build 9.

**If you upload through GitHub (repo connected to Render):**
1. Open your CareBridge repository on github.com.
2. Go to the folder that already contains `index.html` (repo root or `public/`).
3. **Add file → Upload files**, drag in all 7 files above, then **Commit changes**.
4. Open Render → your CareBridge service → wait until it says **Live**.

**If you upload directly in Render:**
1. Put the same 7 files in the same folder that holds `index.html`, replacing the old ones.
2. Deploy and wait for **Live**.

## 2. Check the deploy

1. Open your site address followed by `/manifest.webmanifest`
   (for example `https://care-bridge-app-2pbv.onrender.com/manifest.webmanifest`).
   You should see the four `-v2` icon names.
2. Open the site in a new tab and press **Ctrl+F5**. The tab icon should show the new logo.

## 3. Update the installed app icon

Chrome caches the icon of an app that is already installed, so deploying alone will not
repaint it. Reinstall the app once:

**Windows (the CareBridge desktop shortcut):**
1. Close the CareBridge app window.
2. In Chrome open `chrome://apps`.
3. Right-click **CareBridge → Remove from Chrome**.
4. Open your CareBridge site, click the **install icon** at the right end of the address bar
   (a small screen with a down arrow) → **Install**.
5. The desktop and taskbar icon now use the new logo.
   (If Windows still shows the old one, restart Explorer or sign out and back in — that is
   the Windows icon cache, not the app.)

**Android phone:**
1. Long-press the CareBridge icon → **Uninstall** / **Remove**.
2. Open the site in Chrome → menu **⋮ → Add to Home screen** (or **Install app**).

## Optional — change the desktop shortcut icon right now

If you do not want to reinstall:
1. Right-click the **CareBridge** shortcut → **Properties**.
2. **Change Icon… → Browse…**, pick `CareBridge.ico` from this folder, then **OK → OK**.
3. Chrome may reset it the next time the app is reinstalled or updated.

## One thing to know about the artwork

This is a wide logo, so on very small icons — the browser tab (16–32 px) and the small
desktop view — the words and tagline become hard to read. The 192 px and 512 px icons
(home screen, app window, taskbar) are crisp.

If you want the tab/small icon to stay sharp, I can use just the rounded hospital-cross
badge for sizes 48 px and below, while keeping the full wordmark for the large app icon.
Say the word and I will rebuild the set.
