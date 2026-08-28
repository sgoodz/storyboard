# Storyboard — journey capture for CRO

Map a user journey (landing → category → product → basket → checkout), pick your breakpoints, and Storyboard screenshots every step at every screen size so you can review the whole route side by side, add notes, and export a report.

**Static site — no build step.** Open `index.html` or host the folder on GitHub Pages.

## Capture engines

| | Cloud (default) | Local |
|---|---|---|
| Setup | None | `cd server && npm install && npx playwright install chromium && npm start` |
| Limits | 25 frames/day per network on Microlink's free tier (add an API key in Settings for more) | Unlimited |
| Interactions between steps | No — each step needs a URL | Yes — `click`, `fill`, `type`, `press`, `hover`, `wait`, `scroll`, `hide`, `goto` |
| State carries across steps (basket, login) | No | Yes — one browser context per breakpoint per journey |

The site auto-detects the local engine on `http://localhost:4321` and uses it when it's running.

### Stealth mode (bot-protected sites)

Some retailers (Argos, Currys, Screwfix, John Lewis…) sit behind Akamai or Cloudflare and serve "Access Denied" to headless browsers. Start the engine with

```
npm run start:stealth
```

and it drives your **real, installed Google Chrome** in a visible window instead — the same browser fingerprint as a person, so those sites render normally. Chrome windows will open and close on your screen while it captures; leave them alone. Requires Google Chrome to be installed; falls back to headless Chromium if it isn't.

### Interactions (local engine)

Open a step's **Interactions** box and write one action per line. They run after the page loads and before the frame is captured. Leave the URL blank to continue from wherever the previous step ended.

```
click .add-to-basket
wait 800
fill #email jane@example.com
press Enter
hide .cookie-banner
```

## Deploy to GitHub Pages

```
git init && git add -A && git commit -m "Storyboard"
gh repo create storyboard --public --source=. --push
gh api -X POST repos/{owner}/storyboard/pages -f 'source[branch]=main' -f 'source[path]=/'
```

Then visit `https://<owner>.github.io/storyboard/`.

## Journeys, competitors, exports

- **Journey library** — every journey you build is saved in the browser. Switch between them with the dropdown at the top of the sidebar.
- **Duplicate for another site** — copies the current journey and swaps the domain on every step (paths stay the same), so a "home → category → PDP" route can be re-run against each competitor in seconds.
- **Paste URLs** — accepts one URL per line, or any text that contains URLs (a CSV column, a Screaming Frog export, a sitemap).
- **Export ▾**
  - *All frames (.zip)* — one PNG per step × breakpoint, named `01-homepage-mobile-375.png`, plus `notes.txt`. Drop them straight into Miro, Figma or PowerPoint.
  - *PDF* — cover page with the step list, then one frame per page with its notes.
  - *Web report (.html)* — a single self-contained file with every frame and note embedded.
- **Download PNG** — on any frame, from the lightbox.
- **Copy link** — encodes the journey (name, steps, breakpoints, notes — not the images) into the URL so someone else can open it and capture.

## Worked example — Toolstation, collect vs deliver

[Open this journey in Storyboard](https://sgoodz.github.io/storyboard/#j=eyJuYW1lIjoiVG9vbHN0YXRpb24g4oCUIGNvbWJpIGRyaWxsLCBjb2xsZWN0IHZzIGRlbGl2ZXIiLCJzdGVwcyI6W3sibGFiZWwiOiJIb21lcGFnZSIsInVybCI6Imh0dHBzOi8vd3d3LnRvb2xzdGF0aW9uLmNvbS8iLCJhY3Rpb25zIjoiY2xpY2sgYnV0dG9uOmhhcy10ZXh0KFwiQWxsb3cgYWxsXCIpXG53YWl0IDUwMCJ9LHsibGFiZWwiOiJQb3dlciB0b29scyAobWVnYSBtZW51IGNhdGVnb3J5KSIsInVybCI6Imh0dHBzOi8vd3d3LnRvb2xzdGF0aW9uLmNvbS9wb3dlci10b29scy9jNSIsImFjdGlvbnMiOiIifSx7ImxhYmVsIjoiRHJpbGxzIChzdWItY2F0ZWdvcnkpIiwidXJsIjoiaHR0cHM6Ly93d3cudG9vbHN0YXRpb24uY29tL3Bvd2VyLXRvb2xzL2RyaWxscy9jNzE5IiwiYWN0aW9ucyI6IiJ9LHsibGFiZWwiOiJQcm9kdWN0IHBhZ2UiLCJ1cmwiOiJodHRwczovL3d3dy50b29sc3RhdGlvbi5jb20vZWluaGVsbC1wcm9mZXNzaW9uYWwtcHhjLTE4di04MG5tLWJydXNobGVzcy1jb3JkbGVzcy1jb21iaS1kcmlsbC1raXQvcDE3OTUxIiwiYWN0aW9ucyI6IiJ9LHsibGFiZWwiOiJDaG9vc2UgY2xpY2sgJiBjb2xsZWN0IiwidXJsIjoiIiwiYWN0aW9ucyI6ImNsaWNrIFtkYXRhLXRlc3RpZD1cImFkZC10by10cm9sbGV5LWNvbGxlY3Rpb24tYnV0dG9uXCJdXG53YWl0IDE1MDAifSx7ImxhYmVsIjoiQ2hvb3NlIGhvbWUgZGVsaXZlcnkiLCJ1cmwiOiIiLCJhY3Rpb25zIjoiY2xpY2sgYnV0dG9uOmhhcy10ZXh0KFwiQ2xvc2VcIilcbndhaXQgNTAwXG5jbGljayBbZGF0YS10ZXN0aWQ9XCJhZGQtdG8tdHJvbGxleS1kZWxpdmVyeS1idXR0b25cIl1cbndhaXQgMTUwMCJ9XSwiYnJlYWtwb2ludHMiOlsibW9iaWxlIiwiZGVza3RvcCJdLCJmdWxsUGFnZSI6ZmFsc2V9) (needs the local engine for the last two steps).

| # | Step | URL | Interactions |
|---|------|-----|--------------|
| 01 | Homepage | `https://www.toolstation.com/` | `click button:has-text("Allow all")` — dismisses the cookie banner once; consent carries through the rest of the journey |
| 02 | Power tools (mega-menu category) | `https://www.toolstation.com/power-tools/c5` | — |
| 03 | Drills (sub-category) | `https://www.toolstation.com/power-tools/drills/c719` | — |
| 04 | Product page | `https://www.toolstation.com/einhell-professional-…/p17951` | — |
| 05 | Choose click & collect | *(blank — continues from step 04)* | `click [data-testid="add-to-trolley-collection-button"]` then `wait 1500` → captures the store-picker lightbox |
| 06 | Choose home delivery | *(blank)* | `click button:has-text("Close")`, `wait 500`, `click [data-testid="add-to-trolley-delivery-button"]`, `wait 1500` → captures the "added to trolley" drawer |

Breakpoints: Mobile 375 + Desktop 1440, full page off (so modals are captured as the user sees them). Then **Duplicate for another site** → `screwfix.com` and fix up the paths to repeat it for a competitor.

Finding selectors: right-click the button in Chrome → Inspect, and use its `data-testid`, `id`, or `button:has-text("…")`. Any Playwright selector works.

## Roadmap ideas

- Describe a journey in words ("home → menswear → jeans → a PDP → pick click & collect") and have it worked out from the site's navigation/schema
- Import a Screaming Frog crawl to pick steps from real URL/metadata
- Side-by-side compare of the same step across competitors
- Per-step "viewport only" override for lightbox/modal captures
