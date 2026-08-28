// Storyboard — local capture engine
// A tiny HTTP server that drives a real Chromium via Playwright.
// One browser context per (session, breakpoint) so cookies/basket state
// carry across the steps of a journey.

import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 4321);
const CONTEXT_TTL_MS = 10 * 60 * 1000;

let browser;
const contexts = new Map(); // key -> { context, page, touched }

async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch();
  return browser;
}

async function getPage(key, { width, height, isMobile }) {
  let entry = contexts.get(key);
  if (!entry) {
    const b = await getBrowser();
    const context = await b.newContext({
      viewport: { width, height },
      deviceScaleFactor: isMobile ? 2 : 1,
      isMobile: !!isMobile,
      hasTouch: !!isMobile,
      userAgent: isMobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
    });
    const page = await context.newPage();
    entry = { context, page, touched: Date.now() };
    contexts.set(key, entry);
  }
  entry.touched = Date.now();
  return entry.page;
}

setInterval(async () => {
  const now = Date.now();
  for (const [key, e] of contexts) {
    if (now - e.touched > CONTEXT_TTL_MS) {
      contexts.delete(key);
      await e.context.close().catch(() => {});
    }
  }
}, 60_000).unref();

// Interactions DSL — one per line:
//   click <selector>        fill <selector> <text>     wait <ms>
//   hover <selector>        press <key>                scroll <px>
//   goto <url>              type <selector> <text>     hide <selector>
async function runActions(page, actions = []) {
  for (const raw of actions) {
    const line = String(raw).trim();
    if (!line || line.startsWith("#")) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "click":  await page.locator(arg).first().click({ timeout: 10_000 }); break;
      case "hover":  await page.locator(arg).first().hover({ timeout: 10_000 }); break;
      case "fill": {
        const [sel, ...text] = rest;
        await page.locator(sel).first().fill(text.join(" "), { timeout: 10_000 });
        break;
      }
      case "type": {
        const [sel, ...text] = rest;
        await page.locator(sel).first().pressSequentially(text.join(" "), { timeout: 10_000, delay: 30 });
        break;
      }
      case "press":  await page.keyboard.press(arg); break;
      case "wait":   await page.waitForTimeout(Number(arg) || 1000); break;
      case "scroll": await page.mouse.wheel(0, Number(arg) || 600); break;
      case "goto":   await page.goto(arg, { waitUntil: "domcontentloaded", timeout: 45_000 }); break;
      case "hide":   await page.addStyleTag({ content: `${arg}{display:none !important}` }); break;
      default: throw new Error(`Unknown action: ${cmd}`);
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  }
}

async function capture(body) {
  const { session = "default", url, width = 1440, height = 900, isMobile = false, fullPage = true, actions = [], bpKey = "bp" } = body;
  const page = await getPage(`${session}:${bpKey}`, { width, height, isMobile });

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  } else if (page.url() === "about:blank") {
    throw new Error("This step has no URL and there is no previous page to continue from.");
  }

  await runActions(page, actions);

  // Nudge lazy-loaded content into view before a full-page capture.
  if (fullPage) {
    await page.evaluate(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y < h; y += 800) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(300);
  }

  const buf = await page.screenshot({ fullPage, type: "png", animations: "disabled" });
  return {
    ok: true,
    image: `data:image/png;base64,${buf.toString("base64")}`,
    title: await page.title().catch(() => ""),
    finalUrl: page.url(),
  };
}

function send(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, engine: "playwright", contexts: contexts.size });
  if (req.method === "POST" && req.url === "/capture") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const result = await capture(JSON.parse(raw || "{}"));
      return send(res, 200, result);
    } catch (err) {
      return send(res, 500, { ok: false, error: String(err?.message || err).split("\n")[0] });
    }
  }
  if (req.method === "POST" && req.url === "/reset") {
    for (const [k, e] of contexts) { contexts.delete(k); await e.context.close().catch(() => {}); }
    return send(res, 200, { ok: true });
  }
  send(res, 404, { ok: false, error: "Not found" });
}).listen(PORT, () => {
  console.log(`Storyboard capture engine listening on http://localhost:${PORT}`);
  console.log("Leave this running, then reload Storyboard in the browser.");
});

process.on("SIGINT", async () => { await browser?.close().catch(() => {}); process.exit(0); });
