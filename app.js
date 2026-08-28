/* Storyboard — journey capture for CRO
   Vanilla JS, no build. State lives in `state`, persisted to localStorage,
   shareable via the URL hash. */

(() => {
  "use strict";

  // ───────────────────────── constants ─────────────────────────
  const PRESETS = {
    mobile:  { label: "Mobile",  width: 375,  height: 812,  isMobile: true },
    tablet:  { label: "Tablet",  width: 768,  height: 1024, isMobile: true },
    laptop:  { label: "Laptop",  width: 1280, height: 800 },
    desktop: { label: "Desktop", width: 1440, height: 900 },
    wide:    { label: "Wide",    width: 1920, height: 1080 },
  };
  const DEFAULT_BPS = ["mobile", "tablet", "desktop"];
  const FRAME_H = 300;             // rendered frame height on the board
  const CONCURRENCY = 2;
  const LS_KEY = "storyboard.v1";        // legacy single-journey store (migrated on load)
  const LS_LIB = "storyboard.library";   // { current, journeys: { id: { journey, frames } } }
  const LS_SETTINGS = "storyboard.settings";

  const SAMPLE = {
    name: "Sample — buy a t-shirt",
    steps: [
      { label: "Homepage",       url: "https://demo.vercel.store/",                             actions: "" },
      { label: "Shirts listing", url: "https://demo.vercel.store/search/shirts",                actions: "" },
      { label: "Product page",   url: "https://demo.vercel.store/product/acme-circles-t-shirt", actions: "" },
    ],
    breakpoints: ["mobile", "desktop"],
    fullPage: true,
  };

  // ───────────────────────── state ─────────────────────────
  const uid = () => Math.random().toString(36).slice(2, 9);

  const state = {
    journey: { id: uid(), name: "", steps: [], breakpoints: [...DEFAULT_BPS], fullPage: true, custom: {} },
    frames: {},              // `${stepId}@${bpKey}` -> { status, src, width, height, error, note }
    settings: { engine: "auto", apiKey: "", localUrl: "http://localhost:4321" },
    localAvailable: false,
    quota: null,             // { remaining, limit, reset }
    running: false,
    cancel: false,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    journeyName: $("journeyName"), steps: $("steps"), bps: $("bps"), fullPage: $("fullPage"),
    grid: $("grid"), empty: $("empty"), captureMeta: $("captureMeta"), btnCapture: $("btnCapture"),
    btnExport: $("btnExport"), engineDot: $("engineDot"), engineLabel: $("engineLabel"),
    pasteBox: $("pasteBox"), pasteArea: $("pasteArea"),
    lightbox: $("lightbox"), lbImg: $("lbImg"), lbLabel: $("lbLabel"), lbMeta: $("lbMeta"),
    lbTape: $("lbTape"), lbNote: $("lbNote"), lbOpen: $("lbOpen"),
    settings: $("settings"), apiKey: $("apiKey"), localUrl: $("localUrl"), toast: $("toast"),
    journeySelect: $("journeySelect"), exportMenu: $("exportMenu"),
  };
  let library = { current: null, journeys: {} };

  // Local-engine frames are multi-MB data URLs — keep them in IndexedDB, not localStorage.
  const idb = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("storyboard", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("frames");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async store(mode) { this.db = this.db || await this.open(); return this.db.transaction("frames", mode).objectStore("frames"); },
    req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async put(k, v) { try { return await this.req((await this.store("readwrite")).put(v, k)); } catch (_) {} },
    async get(k) { try { return await this.req((await this.store("readonly")).get(k)); } catch (_) { return null; } },
    async del(k) { try { return await this.req((await this.store("readwrite")).delete(k)); } catch (_) {} },
    async delPrefix(prefix) {
      try {
        const keys = await this.req((await this.store("readonly")).getAllKeys());
        for (const k of keys) if (String(k).startsWith(prefix)) await this.del(k);
      } catch (_) {}
    },
  };
  const idbKey = (journeyId, fk) => `${journeyId}/${fk}`;

  const bpDef = (key) => PRESETS[key] || state.journey.custom[key];
  const frameKey = (stepId, bpKey) => `${stepId}@${bpKey}`;
  const frame = (stepId, bpKey) => state.frames[frameKey(stepId, bpKey)] || { status: "idle" };
  const setFrame = (stepId, bpKey, patch) => {
    const k = frameKey(stepId, bpKey);
    state.frames[k] = { ...(state.frames[k] || { status: "idle" }), ...patch };
    renderFrame(stepId, bpKey);
  };

  // ───────────────────────── persistence ─────────────────────────
  function stripFrames(frames) {
    const out = {};
    for (const [k, f] of Object.entries(frames)) {
      if (f.src && f.src.startsWith("data:")) {
        if (!f.idb) { f.idb = true; idb.put(idbKey(state.journey.id, k), f.src); }
        out[k] = { ...f, src: null };
      } else {
        out[k] = { ...f, idb: false };
      }
    }
    return out;
  }
  async function hydrateFrames() {
    const jid = state.journey.id;
    for (const [k, f] of Object.entries(state.frames)) {
      if (!f.idb || f.src) continue;
      const src = await idb.get(idbKey(jid, k));
      if (state.journey.id !== jid) return; // user switched away mid-load
      if (src) { f.src = src; } else { f.status = f.status === "done" ? "idle" : f.status; f.idb = false; }
      const [stepId, bpKey] = k.split("@"); renderFrame(stepId, bpKey);
    }
    el.btnExport.disabled = !Object.values(state.frames).some((f) => f.status === "done" && f.src);
  }
  function save() {
    try {
      library.current = state.journey.id;
      library.journeys[state.journey.id] = { journey: state.journey, frames: stripFrames(state.frames), updated: Date.now() };
      localStorage.setItem(LS_LIB, JSON.stringify(library));
    } catch (_) {}
    renderJourneySelect();
  }
  function load() {
    try { Object.assign(state.settings, JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}")); } catch (_) {}
    try {
      library = JSON.parse(localStorage.getItem(LS_LIB) || "null") || { current: null, journeys: {} };
      const legacy = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (legacy?.journey && !library.journeys[legacy.journey.id]) {
        library.journeys[legacy.journey.id] = { journey: { custom: {}, ...legacy.journey }, frames: legacy.frames || {}, updated: Date.now() };
        library.current = library.current || legacy.journey.id;
        localStorage.removeItem(LS_KEY);
      }
    } catch (_) {}
    const fromHash = readHash();
    if (fromHash) { applyJourney(fromHash); return; }
    const entry = library.journeys[library.current];
    if (entry) switchTo(library.current);
  }
  function switchTo(id) {
    const entry = library.journeys[id]; if (!entry) return;
    state.journey = { custom: {}, breakpoints: [...DEFAULT_BPS], ...entry.journey };
    state.frames = entry.frames || {};
    for (const f of Object.values(state.frames)) if (f.status === "capturing" || f.status === "queued") f.status = "idle";
    library.current = id;
  }
  function newJourney(partial = {}) {
    state.journey = { id: uid(), name: "", steps: [], breakpoints: [...DEFAULT_BPS], fullPage: true, custom: {}, ...partial };
    state.frames = {};
  }
  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch (_) {}
  }
  function renderJourneySelect() {
    const list = Object.values(library.journeys).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    el.journeySelect.innerHTML =
      list.map((e) => `<option value="${esc(e.journey.id)}" ${e.journey.id === state.journey.id ? "selected" : ""}>${esc(e.journey.name || "Untitled journey")} · ${e.journey.steps.length}</option>`).join("") +
      (library.journeys[state.journey.id] ? "" : `<option value="${esc(state.journey.id)}" selected>${esc(state.journey.name || "Untitled journey")}</option>`) +
      `<option value="__new">+ New journey</option>`;
  }
  function swapHost(url, target) {
    try {
      const u = new URL(url);
      const t = /^https?:\/\//i.test(target) ? new URL(target) : new URL("https://" + target);
      u.protocol = t.protocol; u.host = t.host;
      return u.toString();
    } catch (_) { return url; }
  }

  // ───────────────────────── share link ─────────────────────────
  const b64u = {
    enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
  };
  function readHash() {
    const m = location.hash.match(/^#j=(.+)$/);
    if (!m) return null;
    try {
      const j = JSON.parse(b64u.dec(m[1]));
      history.replaceState(null, "", location.pathname + location.search);
      return j;
    } catch (_) { return null; }
  }
  function shareLink() {
    const notes = {};
    for (const [k, f] of Object.entries(state.frames)) if (f.note) notes[k] = f.note;
    const payload = { ...state.journey, notes };
    return location.origin + location.pathname + "#j=" + b64u.enc(JSON.stringify(payload));
  }
  function applyJourney(j) {
    const steps = (j.steps || []).map((s) => ({ id: s.id || uid(), label: s.label || "", url: s.url || "", actions: s.actions || "" }));
    state.journey = {
      id: j.id || uid(), name: j.name || "", steps,
      breakpoints: (j.breakpoints || DEFAULT_BPS).filter((k) => PRESETS[k] || (j.custom || {})[k]),
      fullPage: j.fullPage !== false, custom: j.custom || {},
    };
    state.frames = {};
    for (const [k, note] of Object.entries(j.notes || {})) state.frames[k] = { status: "idle", note };
  }

  // ───────────────────────── engines ─────────────────────────
  async function detectLocal() {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(state.settings.localUrl.replace(/\/$/, "") + "/health", { signal: ctrl.signal });
      state.localAvailable = r.ok;
    } catch (_) { state.localAvailable = false; }
    renderEngine();
  }
  function activeEngine() {
    const s = state.settings.engine;
    if (s === "local") return "local";
    if (s === "cloud") return "cloud";
    return state.localAvailable ? "local" : "cloud";
  }
  function renderEngine() {
    const e = activeEngine();
    el.engineDot.className = "engine-dot " + (e === "local" ? (state.localAvailable ? "local" : "off") : "cloud");
    if (e === "local") {
      el.engineLabel.textContent = state.localAvailable ? "Local engine · unlimited" : "Local engine not running";
    } else {
      const q = state.quota ? ` · ${state.quota.remaining} of ${state.quota.limit} left today` : "";
      el.engineLabel.textContent = (state.settings.apiKey ? "Cloud engine · keyed" : "Cloud engine") + q;
    }
    renderCaptureMeta();
  }

  async function captureCloud(step, bp, fullPage) {
    if (!step.url) throw new Error("Cloud engine needs a URL on every step.");
    const params = new URLSearchParams({
      url: step.url, screenshot: "true", meta: "false",
      "viewport.width": bp.width, "viewport.height": bp.height,
      "viewport.isMobile": !!bp.isMobile, "viewport.deviceScaleFactor": 1,
      fullPage: !!fullPage,
    });
    const keyed = !!state.settings.apiKey;
    const base = keyed ? "https://pro.microlink.io" : "https://api.microlink.io";
    let r = await fetch(`${base}/?${params}`, { headers: keyed ? { "x-api-key": state.settings.apiKey } : {} });
    if (r.status === 408) r = await fetch(`${base}/?${params}`, { headers: keyed ? { "x-api-key": state.settings.apiKey } : {} }); // slow page: one more try
    const limit = r.headers.get("x-rate-limit-limit"), remaining = r.headers.get("x-rate-limit-remaining");
    if (limit) { state.quota = { limit: +limit, remaining: +remaining, reset: +r.headers.get("x-rate-limit-reset") }; renderEngine(); }
    let json = null;
    try { json = await r.json(); } catch (_) {}
    if (!r.ok || !json || json.status !== "success") {
      const code = json?.code || r.status;
      if (code === "ERATE" || r.status === 429) throw new Error("Daily cloud limit reached. Add an API key in Settings, or run the local engine.");
      if (r.status === 408 || /TIMEOUT|EBRWSRTIMEOUT/i.test(code)) throw new Error("The page took too long to render. Retry, or untick Full page.");
      throw new Error(json?.message || json?.more || `Capture failed (${code})`);
    }
    const s = json.data.screenshot;
    return { src: s.url, width: s.width, height: s.height };
  }

  async function captureLocal(step, bp, bpKey, fullPage) {
    const actions = (step.actions || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const r = await fetch(state.settings.localUrl.replace(/\/$/, "") + "/capture", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: state.journey.id, bpKey, url: step.url, width: bp.width, height: bp.height, isMobile: !!bp.isMobile, fullPage, actions }),
    });
    const json = await r.json().catch(() => ({ ok: false, error: "Local engine returned something unexpected." }));
    if (!json.ok) throw new Error(json.error || "Local capture failed");
    return { src: json.image, width: bp.width, height: null, title: json.title };
  }

  // ───────────────────────── capture run ─────────────────────────
  function validSteps() {
    return state.journey.steps.filter((s) => s.url || activeEngine() === "local");
  }
  async function runCapture() {
    if (state.running) { state.cancel = true; return; }
    const steps = state.journey.steps;
    const bps = state.journey.breakpoints;
    if (!steps.length) return toast("Add at least one step first.");
    if (!bps.length) return toast("Pick at least one breakpoint.");
    const engine = activeEngine();
    if (engine === "local" && !state.localAvailable) { await detectLocal(); if (!state.localAvailable) return openSettings("Local engine isn't running — start it or switch to cloud."); }
    const bad = steps.find((s) => s.url && !isUrl(s.url));
    if (bad) return toast(`Step "${bad.label || bad.url}" has an invalid URL.`);
    if (engine === "cloud" && steps.some((s) => !s.url)) return toast("Every step needs a URL when using the cloud engine.");

    state.running = true; state.cancel = false;
    el.btnCapture.textContent = "Stop capture";
    el.btnCapture.classList.remove("primary");
    showGrid();

    // Queue: for the local engine, steps must run in order within a breakpoint (state carries over),
    // so we walk breakpoints in parallel and steps sequentially. Cloud is stateless: fan out freely.
    const jobs = [];
    for (const bpKey of bps) for (const step of steps) { jobs.push({ step, bpKey }); setFrame(step.id, bpKey, { status: "queued", error: null }); }
    let done = 0; const total = jobs.length;
    const progress = () => renderCaptureMeta(`${done} / ${total} frames`, done / total);
    progress();

    const runOne = async ({ step, bpKey }) => {
      if (state.cancel) { setFrame(step.id, bpKey, { status: "idle" }); return; }
      const bp = bpDef(bpKey);
      setFrame(step.id, bpKey, { status: "capturing" });
      try {
        const res = engine === "local" ? await captureLocal(step, bp, bpKey, state.journey.fullPage) : await captureCloud(step, bp, state.journey.fullPage);
        setFrame(step.id, bpKey, { status: "done", ...res, engine, at: Date.now() });
      } catch (err) {
        setFrame(step.id, bpKey, { status: "error", error: err.message || String(err) });
      }
      done++; progress(); save();
    };

    if (engine === "local") {
      await Promise.all(bps.map(async (bpKey) => { for (const step of steps) await runOne({ step, bpKey }); }));
    } else {
      const queue = [...jobs];
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await runOne(queue.shift()); }));
    }

    state.running = false;
    el.btnCapture.textContent = "Capture journey";
    el.btnCapture.classList.add("primary");
    const errors = Object.values(state.frames).filter((f) => f.status === "error").length;
    renderCaptureMeta(state.cancel ? "Stopped." : errors ? `Done — ${errors} frame${errors > 1 ? "s" : ""} failed. Click a frame to retry.` : "Done.");
    el.btnExport.disabled = !Object.values(state.frames).some((f) => f.status === "done");
    save();
  }

  async function retryFrame(stepId, bpKey) {
    const step = state.journey.steps.find((s) => s.id === stepId); if (!step) return;
    const engine = activeEngine(); const bp = bpDef(bpKey);
    setFrame(stepId, bpKey, { status: "capturing", error: null });
    try {
      const res = engine === "local" ? await captureLocal(step, bp, bpKey, state.journey.fullPage) : await captureCloud(step, bp, state.journey.fullPage);
      setFrame(stepId, bpKey, { status: "done", ...res, engine, at: Date.now() });
      el.btnExport.disabled = false;
    } catch (err) { setFrame(stepId, bpKey, { status: "error", error: err.message }); }
    save();
  }

  // ───────────────────────── rendering: builder ─────────────────────────
  function renderSteps() {
    el.steps.innerHTML = "";
    state.journey.steps.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "step" + (s.actions ? " show-actions" : "");
      li.dataset.id = s.id;
      li.draggable = true;
      li.innerHTML = `
        <span class="step-num" title="Drag to reorder">${String(i + 1).padStart(2, "0")}</span>
        <span class="step-grip" aria-hidden="true">⋮⋮</span>
        <input class="step-label" type="text" placeholder="Step name (e.g. Product page)" value="${esc(s.label)}" data-field="label" />
        <input class="step-url ${s.url && !isUrl(s.url) ? "invalid" : ""}" type="url" placeholder="${i === 0 ? "https://…" : "https://…  (blank = continue from previous page, local engine)"}" value="${esc(s.url)}" data-field="url" spellcheck="false" />
        <div class="step-row">
          <button class="link toggle-actions" type="button">${s.actions ? "Interactions" : "+ Interactions"}</button>
          <span class="hint">· runs before the frame is taken (local engine)</span>
        </div>
        <div class="step-actions">
          <textarea data-field="actions" rows="3" placeholder="click .add-to-basket&#10;wait 800&#10;fill #email jane@example.com">${esc(s.actions)}</textarea>
          <span class="hint">click · fill · type · press · hover · wait · scroll · hide · goto — one per line</span>
        </div>
        <button class="step-remove" type="button" title="Remove step" aria-label="Remove step">×</button>`;
      el.steps.appendChild(li);
    });
    renderCaptureMeta();
  }

  function renderBps() {
    el.bps.innerHTML = "";
    const keys = [...Object.keys(PRESETS), ...Object.keys(state.journey.custom)];
    for (const key of keys) {
      const bp = bpDef(key); const on = state.journey.breakpoints.includes(key);
      const b = document.createElement("button");
      b.type = "button"; b.className = "bp" + (on ? " on" : ""); b.dataset.key = key; b.setAttribute("aria-pressed", on);
      const ratio = Math.min(1, bp.width / bp.height);
      const w = ratio >= 1 ? 16 : Math.max(7, Math.round(16 * ratio)); const h = ratio >= 1 ? Math.round(16 * bp.height / bp.width) : 16;
      b.innerHTML = `<span class="bp-icon"><span style="width:${w}px;height:${h}px"></span></span><span class="bp-name">${esc(bp.label)}</span><span class="bp-size">${bp.width}</span>${PRESETS[key] ? "" : `<span class="bp-x" data-remove="${key}" title="Remove">×</span>`}`;
      el.bps.appendChild(b);
    }
    el.fullPage.checked = state.journey.fullPage;
  }

  function renderCaptureMeta(text, pct) {
    const steps = state.journey.steps.length, bps = state.journey.breakpoints.length;
    const n = steps * bps;
    if (text === undefined) {
      const e = activeEngine();
      let warn = "";
      if (e === "cloud" && state.quota && n > state.quota.remaining) warn = `<span class="warn">Only ${state.quota.remaining} cloud frames left today</span>`;
      el.captureMeta.innerHTML = `<span>${n ? `${n} frame${n === 1 ? "" : "s"} · ${steps} step${steps === 1 ? "" : "s"} × ${bps} breakpoint${bps === 1 ? "" : "s"}` : "Add steps and breakpoints to begin"}</span>${warn}`;
      return;
    }
    el.captureMeta.innerHTML = `<span>${esc(text)}</span>` + (pct !== undefined ? `<div class="progress" style="flex:1 0 100%"><i style="width:${Math.round(pct * 100)}%"></i></div>` : "");
  }

  // ───────────────────────── rendering: board ─────────────────────────
  function showGrid() {
    const has = state.journey.steps.length > 0;
    el.empty.hidden = has; el.grid.hidden = !has;
    if (has) renderGrid();
  }
  function renderGrid() {
    el.grid.innerHTML = "";
    state.journey.steps.forEach((s, i) => {
      const row = document.createElement("section");
      row.className = "row"; row.dataset.step = s.id;
      row.innerHTML = `
        <div class="row-head">
          <span class="tape">${String(i + 1).padStart(2, "0")}</span>
          <span class="row-title">${esc(s.label || (s.url ? hostPath(s.url) : "Untitled step"))}</span>
          ${s.url ? `<a class="row-url" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : `<span class="row-url">continues from previous step</span>`}
        </div>
        <div class="row-frames"></div>`;
      const frames = row.querySelector(".row-frames");
      for (const bpKey of state.journey.breakpoints) {
        const f = document.createElement("div"); f.className = "frame"; f.dataset.bp = bpKey;
        frames.appendChild(f);
        renderFrame(s.id, bpKey, f);
      }
      el.grid.appendChild(row);
    });
  }
  function renderFrame(stepId, bpKey, container) {
    const node = container || el.grid.querySelector(`.row[data-step="${stepId}"] .frame[data-bp="${bpKey}"]`);
    if (!node) return;
    const bp = bpDef(bpKey); if (!bp) return;
    const f = frame(stepId, bpKey);
    const w = Math.round(FRAME_H * bp.width / bp.height);
    const stateText = { idle: "Not captured yet", queued: "Queued", capturing: "Capturing…", error: "Failed", done: "Loading…" }[f.status] || "";
    node.style.width = w + "px";
    node.innerHTML = `
      <div class="frame-head"><b>${esc(bp.label)}</b><span>${bp.width} × ${bp.height}</span></div>
      <div class="frame-shot ${f.status}" style="width:${w}px;height:${FRAME_H}px" role="button" tabindex="0" aria-label="${esc(bp.label)} frame">
        ${f.status === "done" && f.src ? `<img src="${esc(f.src)}" alt="" loading="lazy"${f.src.startsWith("data:") ? "" : " crossorigin=\"anonymous\""} />` : `<div class="frame-state">${esc(stateText)}${f.status === "error" ? `<small>${esc(f.error || "")}<br/>Click to retry</small>` : ""}</div>`}
      </div>
      <div class="frame-foot"><span class="mono dim">${f.height ? `${f.height}px tall` : ""}</span><span class="frame-tools"><span class="note-flag ${f.note ? "has" : ""}">${f.note ? "Notes" : ""}</span>${f.status === "done" ? `<button class="link" data-retry>Retake</button>` : ""}</span></div>`;
  }

  // ───────────────────────── lightbox ─────────────────────────
  const lb = { stepId: null, bpKey: null };
  function openLightbox(stepId, bpKey) {
    const f = frame(stepId, bpKey); if (f.status !== "done") return;
    lb.stepId = stepId; lb.bpKey = bpKey;
    const step = state.journey.steps.find((s) => s.id === stepId); const bp = bpDef(bpKey);
    const idx = state.journey.steps.indexOf(step);
    el.lbTape.textContent = String(idx + 1).padStart(2, "0");
    el.lbLabel.textContent = step.label || hostPath(step.url) || "Untitled step";
    el.lbMeta.textContent = `${bp.label} · ${bp.width}px`;
    el.lbImg.src = f.src; el.lbImg.style.width = Math.min(bp.width, window.innerWidth - 380) + "px";
    el.lbOpen.href = f.src; el.lbOpen.hidden = f.src.startsWith("data:");
    el.lbNote.value = f.note || "";
    el.lightbox.hidden = false; document.body.style.overflow = "hidden";
    el.lightbox.querySelector(".lightbox-shot").scrollTop = 0;
  }
  function closeLightbox() { el.lightbox.hidden = true; document.body.style.overflow = ""; lb.stepId = null; }
  function moveLightbox(dir) {
    const bps = state.journey.breakpoints; let i = bps.indexOf(lb.bpKey) + dir;
    let stepIdx = state.journey.steps.findIndex((s) => s.id === lb.stepId);
    if (i < 0) { stepIdx--; i = bps.length - 1; } if (i >= bps.length) { stepIdx++; i = 0; }
    const step = state.journey.steps[stepIdx]; if (!step) return;
    if (frame(step.id, bps[i]).status === "done") openLightbox(step.id, bps[i]);
  }

  // ───────────────────────── export ─────────────────────────
  const pad2 = (n) => String(n + 1).padStart(2, "0");
  const slug = (t) => String(t || "").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "frame";
  function frameName(step, i, bpKey, ext) {
    const bp = bpDef(bpKey);
    return `${pad2(i)}-${slug(step.label || hostPath(step.url))}-${slug(bp.label)}-${bp.width}.${ext}`;
  }
  async function frameBlob(src) {
    if (src.startsWith("data:")) return await (await fetch(src)).blob();
    return await (await fetch(src, { mode: "cors", cache: "no-store" })).blob();
  }
  const blobToData = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  function downloadBlob(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function doneFrames() {
    const out = [];
    state.journey.steps.forEach((step, i) => {
      for (const bpKey of state.journey.breakpoints) {
        const f = frame(step.id, bpKey);
        if (f.status === "done" && f.src) out.push({ step, i, bpKey, f });
      }
    });
    return out;
  }
  const journeySlug = () => slug(state.journey.name || "journey");

  async function withBusy(label, fn) {
    el.btnExport.disabled = true; el.btnExport.textContent = label;
    try { await fn(); }
    catch (err) { toast("Export failed: " + (err.message || err)); }
    finally { el.btnExport.disabled = false; el.btnExport.textContent = "Export ▾"; }
  }

  async function exportZip() {
    await withBusy("Zipping…", async () => {
      const zip = new JSZip();
      const folder = zip.folder(journeySlug());
      const notes = [];
      for (const { step, i, bpKey, f } of doneFrames()) {
        folder.file(frameName(step, i, bpKey, "png"), await frameBlob(f.src));
        if (f.note) notes.push(`${pad2(i)} ${step.label || step.url} — ${bpDef(bpKey).label}\n${f.note}\n`);
      }
      if (notes.length) folder.file("notes.txt", notes.join("\n"));
      downloadBlob(await zip.generateAsync({ type: "blob" }), `${journeySlug()}-frames.zip`);
      toast("ZIP downloaded.");
    });
  }

  async function exportPdf() {
    await withBusy("Building PDF…", async () => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "px", format: "a4", orientation: "landscape", hotfixes: ["px_scaling"] });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 28;
      // cover
      doc.setFont("helvetica", "bold"); doc.setFontSize(30); doc.text(state.journey.name || "Untitled journey", M, M + 30);
      doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(107, 114, 128);
      doc.text(`${state.journey.steps.length} steps · ${state.journey.breakpoints.map((k) => bpDef(k).label).join(", ")} · ${new Date().toLocaleDateString()} · Storyboard`, M, M + 52);
      let y = M + 90; doc.setTextColor(31, 34, 39);
      state.journey.steps.forEach((st, i) => { doc.text(`${pad2(i)}  ${st.label || hostPath(st.url) || "Untitled step"}`, M, y); y += 18; });
      for (const { step, i, bpKey, f } of doneFrames()) {
        doc.addPage();
        const bp = bpDef(bpKey);
        doc.setFillColor(245, 197, 66); doc.rect(M, M - 14, 26, 16, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(43, 34, 0); doc.text(pad2(i), M + 5, M - 2);
        doc.setFontSize(16); doc.setTextColor(31, 34, 39); doc.text(step.label || hostPath(step.url) || "Untitled step", M + 34, M);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(107, 114, 128);
        doc.text(`${bp.label} · ${bp.width}px${step.url ? "  ·  " + step.url : ""}`, M, M + 16);
        const data = f.src.startsWith("data:") ? f.src : await blobToData(await frameBlob(f.src));
        const dim = await new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: bp.width, h: bp.height }); im.src = data; });
        const noteW = f.note ? 200 : 0;
        const maxW = W - M * 2 - noteW - (noteW ? 16 : 0), maxH = H - M * 2 - 30;
        const scale = Math.min(maxW / dim.w, maxH / dim.h);
        const w = dim.w * scale, h = dim.h * scale;
        doc.addImage(data, "PNG", M, M + 30, w, h, undefined, "FAST");
        if (f.note) {
          doc.setFontSize(10); doc.setTextColor(31, 34, 39);
          doc.text(doc.splitTextToSize(f.note, noteW), M + w + 16, M + 42);
        }
      }
      doc.save(`${journeySlug()}-storyboard.pdf`);
      toast("PDF downloaded.");
    });
  }

  async function exportHtml() {
    await withBusy("Building report…", async () => {
      const toData = async (src) => { try { return src.startsWith("data:") ? src : await blobToData(await frameBlob(src)); } catch (_) { return src; } };
      const rows = [];
      for (const [i, s] of state.journey.steps.entries()) {
        const cells = [];
        for (const bpKey of state.journey.breakpoints) {
          const f = frame(s.id, bpKey); const bp = bpDef(bpKey);
          const img = f.status === "done" ? `<img src="${await toData(f.src)}" alt="" />` : `<div class="missing">Not captured</div>`;
          cells.push(`<figure><figcaption><b>${esc(bp.label)}</b> ${bp.width}px</figcaption>${img}${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}</figure>`);
        }
        rows.push(`<section><h2><span class="tape">${pad2(i)}</span> ${esc(s.label || hostPath(s.url) || "Untitled step")}</h2>${s.url ? `<a class="url" href="${esc(s.url)}">${esc(s.url)}</a>` : ""}<div class="frames">${cells.join("")}</div></section>`);
      }
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(state.journey.name || "Journey")} — Storyboard report</title>
<style>body{margin:0;background:#E4E6EA;color:#1F2227;font:14px/1.45 "IBM Plex Sans",system-ui,sans-serif;padding:32px}h1{font-size:34px;letter-spacing:-.03em;margin:0 0 4px}.sub{color:#6B7280;margin:0 0 36px}section{margin-bottom:40px}h2{font-size:20px;letter-spacing:-.02em;margin:0 0 4px;display:flex;gap:10px;align-items:baseline}.tape{font:500 12px ui-monospace,monospace;background:#F5C542;color:#2B2200;padding:2px 8px;transform:rotate(-1.5deg);display:inline-block}.url{display:block;color:#6B7280;font:12px ui-monospace,monospace;margin-bottom:12px;word-break:break-all}.frames{display:flex;gap:18px;overflow-x:auto;align-items:flex-start;padding-bottom:8px}figure{margin:0;flex:0 0 auto;max-width:600px}figcaption{font:11px ui-monospace,monospace;color:#6B7280;margin-bottom:6px}img{display:block;max-width:100%;background:#fff;box-shadow:0 1px 2px rgba(31,34,39,.12),0 8px 24px -12px rgba(31,34,39,.35)}.missing{width:300px;height:200px;display:grid;place-items:center;color:#6B7280;background:repeating-linear-gradient(135deg,#F3F4F6 0 8px,#ECEEF1 8px 16px)}.note{background:#fff;border-left:3px solid #F5C542;padding:8px 10px;margin:8px 0 0;white-space:pre-wrap}@media print{.frames{flex-wrap:wrap;overflow:visible}}</style></head>
<body><h1>${esc(state.journey.name || "Untitled journey")}</h1><p class="sub">${state.journey.steps.length} steps · ${state.journey.breakpoints.map((k) => bpDef(k).label).join(", ")} · captured ${new Date().toLocaleDateString()} with Storyboard</p>${rows.join("")}</body></html>`;
      downloadBlob(new Blob([html], { type: "text/html" }), `${journeySlug()}-storyboard.html`);
      toast("Report downloaded.");
    });
  }

  async function downloadFrame(stepId, bpKey) {
    const step = state.journey.steps.find((s) => s.id === stepId); const i = state.journey.steps.indexOf(step);
    const f = frame(stepId, bpKey); if (f.status !== "done") return;
    try { downloadBlob(await frameBlob(f.src), frameName(step, i, bpKey, "png")); }
    catch (_) { window.open(f.src, "_blank"); }
  }

  // ───────────────────────── helpers ─────────────────────────
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function isUrl(u) { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch (_) { return false; } }
  function hostPath(u) { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, ""); } catch (_) { return u; } }
  function labelFromUrl(u) {
    try {
      const p = new URL(u).pathname.split("/").filter(Boolean);
      if (!p.length) return "Homepage";
      return p[p.length - 1].replace(/[-_]+/g, " ").replace(/\.\w+$/, "").replace(/^\w/, (c) => c.toUpperCase());
    } catch (_) { return ""; }
  }
  let toastTimer;
  function toast(msg) { el.toast.textContent = msg; el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.toast.hidden = true), 3200); }
  function addStep(partial = {}) {
    state.journey.steps.push({ id: uid(), label: "", url: "", actions: "", ...partial });
  }
  function openSettings(msg) {
    el.settings.hidden = false;
    document.querySelector(`input[name="engine"][value="${state.settings.engine}"]`).checked = true;
    el.apiKey.value = state.settings.apiKey; el.localUrl.value = state.settings.localUrl;
    if (msg) toast(msg);
  }

  // ───────────────────────── events ─────────────────────────
  el.journeyName.addEventListener("input", () => { state.journey.name = el.journeyName.value; save(); });
  el.journeySelect.addEventListener("change", () => {
    const v = el.journeySelect.value;
    if (state.running) { renderJourneySelect(); return toast("Wait for the capture to finish first."); }
    if (v === "__new") { newJourney(); renderAll(); save(); el.journeyName.focus(); return; }
    switchTo(v); renderAll(); save();
  });
  $("btnDuplicate").addEventListener("click", () => {
    if (!state.journey.steps.length) return toast("Add some steps first.");
    const target = prompt("Which site should this copy point at?\nEnter a domain (e.g. competitor.co.uk) — every step keeps its path, or leave blank for an exact copy.", "");
    if (target === null) return;
    const src = state.journey;
    const steps = src.steps.map((st) => ({ ...st, id: uid(), url: target.trim() && st.url ? swapHost(st.url, target.trim()) : st.url }));
    const host = target.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    newJourney({ name: host ? `${(src.name || "Journey").replace(/ — .*$/, "")} — ${host}` : `${src.name || "Journey"} (copy)`, steps, breakpoints: [...src.breakpoints], fullPage: src.fullPage, custom: { ...src.custom } });
    renderAll(); save(); toast(host ? `Duplicated for ${host} — check the paths, then capture.` : "Journey duplicated.");
  });
  $("btnDelete").addEventListener("click", () => {
    if (state.running) return toast("Wait for the capture to finish first.");
    if (!confirm(`Delete "${state.journey.name || "this journey"}"? Screenshots and notes go with it.`)) return;
    idb.delPrefix(state.journey.id + "/");
    delete library.journeys[state.journey.id];
    const next = Object.values(library.journeys).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
    if (next) switchTo(next.journey.id); else newJourney();
    renderAll(); save();
  });

  $("btnAddStep").addEventListener("click", () => { addStep(); renderSteps(); showGrid(); save(); el.steps.querySelector(".step:last-child .step-label")?.focus(); });
  $("btnPaste").addEventListener("click", () => { el.pasteBox.hidden = false; el.pasteArea.focus(); });
  $("btnPasteCancel").addEventListener("click", () => { el.pasteBox.hidden = true; });
  $("btnPasteAdd").addEventListener("click", () => {
    const text = el.pasteArea.value;
    const abs = (text.match(/https?:\/\/[^\s"'<>,;|)\]]+/gi) || []).map((u) => u.replace(/[.,;:]+$/, ""));
    const bare = text.replace(/https?:\/\/[^\s"'<>,;|)\]]+/gi, " ").split(/[\s,;"']+/)
      .filter((u) => /^[\w-]+(\.[a-z]{2,})+(\/\S*)?$/i.test(u)).map((u) => "https://" + u.replace(/[.,;:]+$/, ""));
    const urls = [...new Set([...abs, ...bare])];
    if (!urls.length) return toast("Paste at least one URL.");
    for (const u of urls) addStep({ url: u, label: labelFromUrl(u) });
    el.pasteArea.value = ""; el.pasteBox.hidden = true;
    renderSteps(); showGrid(); save(); toast(`Added ${urls.length} step${urls.length > 1 ? "s" : ""}.`);
  });
  const loadSample = () => { applyJourney({ ...SAMPLE, id: uid() }); renderAll(); save(); toast("Sample journey loaded — hit Capture."); };
  $("btnSample").addEventListener("click", loadSample);
  $("btnSample2").addEventListener("click", loadSample);
  $("btnFocusStep").addEventListener("click", () => { if (!state.journey.steps.length) addStep(); renderSteps(); showGrid(); el.steps.querySelector(".step-url")?.focus(); });

  el.steps.addEventListener("input", (e) => {
    const li = e.target.closest(".step"); if (!li) return;
    const s = state.journey.steps.find((x) => x.id === li.dataset.id); if (!s) return;
    const field = e.target.dataset.field; if (!field) return;
    s[field] = e.target.value;
    if (field === "url") {
      e.target.classList.toggle("invalid", !!s.url && !isUrl(s.url));
      if (!s.label && isUrl(s.url)) { s.label = labelFromUrl(s.url); li.querySelector(".step-label").value = s.label; }
    }
    // Keep the board header in sync without a full re-render.
    const row = el.grid.querySelector(`.row[data-step="${s.id}"]`);
    if (row) { row.querySelector(".row-title").textContent = s.label || (s.url ? hostPath(s.url) : "Untitled step"); const a = row.querySelector(".row-url"); if (a) { a.textContent = s.url || "continues from previous step"; if (a.tagName === "A") a.href = s.url; } }
    save();
  });
  el.steps.addEventListener("click", (e) => {
    const li = e.target.closest(".step"); if (!li) return;
    if (e.target.closest(".step-remove")) {
      state.journey.steps = state.journey.steps.filter((x) => x.id !== li.dataset.id);
      for (const k of Object.keys(state.frames)) if (k.startsWith(li.dataset.id + "@")) { delete state.frames[k]; idb.del(idbKey(state.journey.id, k)); }
      renderSteps(); showGrid(); save();
    } else if (e.target.closest(".toggle-actions")) {
      li.classList.toggle("show-actions");
      if (li.classList.contains("show-actions")) li.querySelector("textarea").focus();
    }
  });
  // drag-to-reorder
  let dragId = null;
  el.steps.addEventListener("dragstart", (e) => { const li = e.target.closest(".step"); if (!li) return; dragId = li.dataset.id; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
  el.steps.addEventListener("dragend", () => { dragId = null; el.steps.querySelectorAll(".step").forEach((n) => n.classList.remove("dragging", "drop-before", "drop-after")); });
  el.steps.addEventListener("dragover", (e) => {
    const li = e.target.closest(".step"); if (!li || !dragId || li.dataset.id === dragId) return;
    e.preventDefault();
    const before = e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2;
    el.steps.querySelectorAll(".step").forEach((n) => n.classList.remove("drop-before", "drop-after"));
    li.classList.add(before ? "drop-before" : "drop-after");
  });
  el.steps.addEventListener("drop", (e) => {
    const li = e.target.closest(".step"); if (!li || !dragId) return;
    e.preventDefault();
    const before = e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2;
    const steps = state.journey.steps; const from = steps.findIndex((s) => s.id === dragId); const [moved] = steps.splice(from, 1);
    let to = steps.findIndex((s) => s.id === li.dataset.id); if (!before) to++;
    steps.splice(to, 0, moved);
    renderSteps(); showGrid(); save();
  });

  el.bps.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (rm) { const k = rm.dataset.remove; delete state.journey.custom[k]; state.journey.breakpoints = state.journey.breakpoints.filter((x) => x !== k); renderBps(); showGrid(); save(); return; }
    const b = e.target.closest(".bp"); if (!b) return;
    const k = b.dataset.key; const on = state.journey.breakpoints.includes(k);
    state.journey.breakpoints = on ? state.journey.breakpoints.filter((x) => x !== k) : [...Object.keys(PRESETS), ...Object.keys(state.journey.custom)].filter((x) => x === k || state.journey.breakpoints.includes(x));
    renderBps(); showGrid(); renderCaptureMeta(); save();
  });
  $("btnCustomBp").addEventListener("click", () => {
    const v = prompt("Custom breakpoint — width × height in px (e.g. 1024x768):", "1024x768"); if (!v) return;
    const m = v.match(/(\d+)\s*[x×,\s]\s*(\d+)/); if (!m) return toast("Use the form 1024x768.");
    const key = "c" + m[1] + "x" + m[2];
    state.journey.custom[key] = { label: `${m[1]}px`, width: +m[1], height: +m[2], isMobile: +m[1] < 900 };
    state.journey.breakpoints.push(key); renderBps(); showGrid(); save();
  });
  el.fullPage.addEventListener("change", () => { state.journey.fullPage = el.fullPage.checked; save(); });

  el.btnCapture.addEventListener("click", runCapture);
  el.btnExport.addEventListener("click", () => { const open = el.exportMenu.hidden; el.exportMenu.hidden = !open; el.btnExport.setAttribute("aria-expanded", open); });
  el.exportMenu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-export]"); if (!b) return;
    el.exportMenu.hidden = true;
    if (!doneFrames().length) return toast("Nothing captured yet.");
    ({ zip: exportZip, pdf: exportPdf, html: exportHtml })[b.dataset.export]();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) el.exportMenu.hidden = true; });
  $("lbDownload").addEventListener("click", () => lb.stepId && downloadFrame(lb.stepId, lb.bpKey));
  $("btnShare").addEventListener("click", async () => {
    if (!state.journey.steps.length) return toast("Add some steps first.");
    const link = shareLink();
    try { await navigator.clipboard.writeText(link); toast("Link copied — it carries the journey, not the screenshots."); }
    catch (_) { prompt("Copy this link:", link); }
  });

  el.grid.addEventListener("click", (e) => {
    const retry = e.target.closest("[data-retry]");
    const shot = e.target.closest(".frame-shot");
    const fr = e.target.closest(".frame"); const row = e.target.closest(".row");
    if (!fr || !row) return;
    const stepId = row.dataset.step, bpKey = fr.dataset.bp;
    if (retry) return retryFrame(stepId, bpKey);
    if (!shot) return;
    const f = frame(stepId, bpKey);
    if (f.status === "done") openLightbox(stepId, bpKey);
    else if (f.status === "error" || f.status === "idle") retryFrame(stepId, bpKey);
  });
  el.grid.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("frame-shot")) e.target.click(); });

  $("lbClose").addEventListener("click", closeLightbox);
  $("lbPrev").addEventListener("click", () => moveLightbox(-1));
  $("lbNext").addEventListener("click", () => moveLightbox(1));
  el.lightbox.addEventListener("click", (e) => { if (e.target === el.lightbox.querySelector(".lightbox-shot")) closeLightbox(); });
  el.lbNote.addEventListener("input", () => { if (!lb.stepId) return; setFrame(lb.stepId, lb.bpKey, { note: el.lbNote.value }); save(); });
  document.addEventListener("keydown", (e) => {
    if (!el.lightbox.hidden) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft" && e.target !== el.lbNote) moveLightbox(-1);
      if (e.key === "ArrowRight" && e.target !== el.lbNote) moveLightbox(1);
    } else if (!el.settings.hidden && e.key === "Escape") el.settings.hidden = true;
  });

  $("engineSettings").addEventListener("click", () => openSettings());
  $("settingsClose").addEventListener("click", () => { el.settings.hidden = true; });
  el.settings.addEventListener("click", (e) => { if (e.target === el.settings) el.settings.hidden = true; });
  el.settings.addEventListener("change", (e) => {
    if (e.target.name === "engine") { state.settings.engine = e.target.value; saveSettings(); detectLocal(); }
  });
  el.apiKey.addEventListener("input", () => { state.settings.apiKey = el.apiKey.value.trim(); state.quota = null; saveSettings(); renderEngine(); });
  el.localUrl.addEventListener("change", () => { state.settings.localUrl = el.localUrl.value.trim() || "http://localhost:4321"; saveSettings(); detectLocal(); });

  window.addEventListener("hashchange", () => { const j = readHash(); if (j) { applyJourney(j); renderAll(); save(); toast("Journey loaded from link."); } });

  // ───────────────────────── boot ─────────────────────────
  function renderAll() {
    el.journeyName.value = state.journey.name;
    renderSteps(); renderBps(); showGrid(); renderJourneySelect();
    el.btnExport.disabled = !Object.values(state.frames).some((f) => f.status === "done" && f.src);
    hydrateFrames();
  }
  load();
  renderAll();
  detectLocal();
})();
