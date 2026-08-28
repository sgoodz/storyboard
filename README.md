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

## Roadmap ideas

- Describe a journey in words ("home → menswear → jeans → a PDP → pick click & collect") and have it worked out from the site's navigation/schema
- Import a Screaming Frog crawl to pick steps from real URL/metadata
- Side-by-side compare of the same step across competitors
- Per-step "viewport only" override for lightbox/modal captures
