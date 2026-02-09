import Fastify from 'fastify';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import fastifyStatic from '@fastify/static';

const PORT = Number(process.env.PORT || 1212);
const HOST = process.env.HOST || '127.0.0.1';

// Flash control auth
// Flash control password (set via env; intentionally no default)
const FLASH_PASS = String(process.env.FLASH_PASS || '');

const CAMS = [
  { id: 'home', name: "Home" },
  { id: 'yard', name: "Yard" },
  { id: 'backyard', name: "Backyard" },
  { id: 'top', name: 'Top' },
];

const DATA_DIR = process.env.DATA_DIR || path.resolve('./data');
const FRAMES_DIR = path.join(DATA_DIR, 'frames');
const KEYS_PATH = path.join(DATA_DIR, 'keys.json');

async function ensureDirs() {
  await fs.mkdir(FRAMES_DIR, { recursive: true });
}

async function loadKeys() {
  try {
    const raw = await fs.readFile(KEYS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    const keys = {};
    for (const cam of CAMS) {
      keys[cam.id] = crypto.randomBytes(24).toString('hex');
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(KEYS_PATH, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
    return keys;
  }
}

function nowIso() {
  return new Date().toISOString();
}

const app = Fastify({ logger: true, bodyLimit: 1_500_000 }); // 1.5MB

// Accept raw JPEG bodies
app.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, (req, body, done) => {
  done(null, body);
});

await ensureDirs();
const keys = await loadKeys();

// Static assets (if we add any later)
app.register(fastifyStatic, {
  root: path.resolve('./public'),
  prefix: '/public/',
  decorateReply: false,
});

// Simple in-memory metadata (persist later if needed)
// camId -> { lastAt, lastAtMs, bytes, ip, rssi, heap, helloAt, helloAtMs, version }
const meta = new Map();

app.get('/', async (req, reply) => {
  reply.header('content-type', 'text/html; charset=utf-8');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>YourPet Cams</title>
  <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" />
  <style>
    :root {
      color-scheme: dark;
      --bg0: #050b14;
      --panel: rgba(17, 24, 39, 0.66);
      --panel2: rgba(17, 24, 39, 0.82);
      --border: rgba(255,255,255,0.09);
      --text: #e5e7eb;
      --muted: #9ca3af;
      --good: #22c55e;
      --bad: #ef4444;
      --warn: #f59e0b;
      --accent: #34d399;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: var(--text);
      background: var(--bg0);
      background-image: url('/public/bg.svg');
      background-size: cover;
      background-attachment: fixed;
    }

    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 18px 16px 22px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .logo {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: rgba(5, 46, 27, 0.55);
      border: 1px solid rgba(52, 211, 153, 0.25);
      display: grid;
      place-items: center;
      box-shadow: 0 10px 30px rgba(0,0,0,.25);
      overflow: hidden;
      flex: 0 0 auto;
    }

    .logo img { width: 38px; height: 38px; }

    h1 {
      font-size: 18px;
      margin: 0;
      letter-spacing: 0.2px;
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tag {
      color: var(--muted);
      font-size: 12px;
      margin-top: 3px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 999px;
      background: rgba(17,24,39,0.6);
      border: 1px solid rgba(255,255,255,0.10);
      color: var(--muted);
      font-size: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.2);
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .pill strong { color: var(--text); font-weight: 600; }

    .seg {
      display: inline-flex;
      background: rgba(17,24,39,0.55);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 999px;
      padding: 4px;
      gap: 4px;
      box-shadow: 0 10px 30px rgba(0,0,0,.18);
      flex: 0 0 auto;
    }

    .seg button {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 7px 10px;
      border-radius: 999px;
      font-size: 12px;
      cursor: pointer;
    }

    .seg button.active {
      background: rgba(52,211,153,0.16);
      color: var(--text);
      border: 1px solid rgba(52,211,153,0.25);
    }

    .camgrid {
      width: 100%;
      /* Use viewport height so tiles don't turn into weird squares on desktop. */
      height: calc(100vh - 120px);
      min-height: 520px;
      display: grid;
      grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr));
      grid-template-rows: repeat(var(--rows, 2), minmax(0, 1fr));
      gap: 0;
      border-radius: 18px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: 0 18px 60px rgba(0,0,0,0.35);
      background: rgba(0,0,0,0.35);
    }

    @media (max-width: 820px) {
      .camgrid {
        aspect-ratio: auto;
        min-height: calc(100vh - 110px);
        grid-template-columns: 1fr;
        grid-template-rows: auto;
        border-radius: 14px;
      }
    }

    .card {
      position: relative;
      background: #000;
      border: 0;
      border-radius: 0;
      overflow: hidden;
    }

    .cardhead {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 5;
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      background: linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0));
      text-shadow: 0 2px 10px rgba(0,0,0,0.95);
      pointer-events: none;
    }

    .name {
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 0.2px;
      line-height: 1.1;
    }

    .camicon { display: none; }

    .status {
      font-size: 12px;
      color: var(--muted);
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--warn); }
    .dot.ok { background: var(--good); }
    .dot.bad { background: var(--bad); }

    .frame {
      position: relative;
      background: #030712;
      border-top: 1px solid rgba(255,255,255,0.05);
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }

    .frame img {
      width: 100%;
      height: 100%;
      /* Show the full camera image (no cropping). */
      object-fit: contain;
      object-position: center;
      display: block;
      background: #000;
      filter: saturate(1.1) contrast(1.05);
    }

    .flashbtn {
      position: absolute;
      bottom: 10px;
      right: 10px;
      z-index: 6;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(17,24,39,0.55);
      color: rgba(229,231,235,0.92);
      padding: 8px 10px;
      border-radius: 999px;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      opacity: 1;
      transform: translateY(0);
      transition: background 160ms ease, transform 160ms ease;
      backdrop-filter: blur(6px);
      pointer-events: auto;
    }
    .flashbtn:active { transform: translateY(1px); }
    .flashbtn.on { background: rgba(245, 158, 11, 0.55); border-color: rgba(245, 158, 11, 0.35); }
    .flashbtn[disabled] { opacity: 0.4; cursor: not-allowed; }

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 4;
      display: grid;
      place-items: center;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0.4), rgba(0,0,0,0.72));
      color: rgba(229,231,235,0.9);
      font-size: 12px;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      gap: 10px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms ease;
    }

    .overlay.show { opacity: 1; }

    .overlay .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 999px;
      background: rgba(17,24,39,0.72);
      border: 1px solid rgba(239,68,68,0.35);
      color: #fecaca;
    }

    .foot { display:none; }
    code { color: #cbd5e1; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; }
    .hint { display:none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <div class="logo" title="Russian tortoise patrol">
          <img src="/public/turtle.svg" alt="turtle" />
        </div>
        <div>
          <h1>YourPet Cams</h1>
          <div class="tag">A tiny self-hosted pet-cam dashboard.</div>
        </div>
      </div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
        <div class="seg" role="tablist" aria-label="view">
          <button data-view="1" class="viewbtn">1</button>
          <button data-view="2" class="viewbtn">2</button>
          <button data-view="4" class="viewbtn">4</button>
          <button data-view="6" class="viewbtn">6</button>
          <button data-view="10" class="viewbtn">10</button>
        </div>
        <div class="pill" id="pager" style="display:none; gap:8px; align-items:center;">
          <button id="prevPage" style="all:unset; cursor:pointer; padding:4px 8px; border:1px solid rgba(255,255,255,0.14); border-radius:999px;">◀</button>
          <span id="pageLabel" style="font-weight:800;">—</span>
          <button id="nextPage" style="all:unset; cursor:pointer; padding:4px 8px; border:1px solid rgba(255,255,255,0.14); border-radius:999px;">▶</button>
        </div>
        <button id="settingsBtn" class="pill" type="button" title="Settings" style="cursor:pointer; user-select:none;">⚙︎</button>
        <div class="pill"><strong>Live</strong> • refresh 1s • <span id="clock"></span></div>
      </div>
    </div>

    <div class="camgrid" id="grid"></div>
  </div>

<script>
const cams = ${JSON.stringify(CAMS)};
const refreshMs = 1000;
const offlineMs = 12000;

const grid = document.getElementById('grid');
const viewBtns = Array.from(document.querySelectorAll('.viewbtn'));

const pager = document.getElementById('pager');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageLabel = document.getElementById('pageLabel');
const settingsBtn = document.getElementById('settingsBtn');

const LS_FLASH_SECS = 'plutcam_flash_seconds';
const LS_CAM_NAMES = 'plutcam_cam_names';

function getFlashSeconds() {
  const v = Number(localStorage.getItem(LS_FLASH_SECS) || '10');
  if (!Number.isFinite(v)) return 10;
  return Math.min(Math.max(Math.round(v), 1), 60);
}

function getCustomNames() {
  try { return JSON.parse(localStorage.getItem(LS_CAM_NAMES) || '{}') || {}; }
  catch { return {}; }
}

function displayNameFor(cam) {
  const names = getCustomNames();
  return String(names[cam.id] || cam.name || cam.id);
}

function setLayoutFor(n) {
  // columns + rows for clean split.
  // Default is 4 cams => 2x2.
  let cols = 2;
  let rows = 2;

  if (n === 1) { cols = 1; rows = 1; }
  else if (n === 2) { cols = 2; rows = 1; }
  else if (n === 4) { cols = 2; rows = 2; }
  else if (n === 6) { cols = 3; rows = 2; }
  else if (n === 10) { cols = 5; rows = 2; }

  document.documentElement.style.setProperty('--cols', String(cols));
  document.documentElement.style.setProperty('--rows', String(rows));
}

// view switching is initialized after cards are created
let applyView = (n) => {};

function el(tag, attrs={}, children=[]) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.appendChild(c);
  return e;
}

const cards = new Map();

// Password-protected flash control (stored per-session in sessionStorage)
const FLASH_PASS_KEY = 'pluto_flash_pass';

function ensureFlashPass() {
  const saved = sessionStorage.getItem(FLASH_PASS_KEY);
  if (saved) return saved;

  // Small modal prompt
  const overlay = el('div', { class: 'flashmodal' });
  overlay.innerHTML =
    '<div class="box">' +
      '<div class="t">Flash control</div>' +
      '<div class="s">Enter password to enable flash buttons.</div>' +
      '<input class="i" type="password" placeholder="Password" autofocus />' +
      '<div class="row">' +
        '<button class="b cancel" type="button">Cancel</button>' +
        '<button class="b ok" type="button">OK</button>' +
      '</div>' +
    '</div>';

  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,.65)',
    display: 'grid', placeItems: 'center', zIndex: '9999',
  });
  overlay.querySelector('.box').style.cssText = 'width:min(360px,92vw);background:rgba(17,24,39,.92);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;box-shadow:0 20px 80px rgba(0,0,0,.55);';
  overlay.querySelector('.t').style.cssText = 'font-weight:900;margin-bottom:6px;';
  overlay.querySelector('.s').style.cssText = 'color:#9ca3af;font-size:12px;margin-bottom:10px;';
  overlay.querySelector('.i').style.cssText = 'width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.3);color:#e5e7eb;outline:none;';
  overlay.querySelector('.row').style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:12px;';
  for (const b of overlay.querySelectorAll('.b')) {
    b.style.cssText = 'padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,24,39,.65);color:#e5e7eb;cursor:pointer;font-weight:800;';
  }
  overlay.querySelector('.ok').style.background = 'rgba(52,211,153,.18)';
  overlay.querySelector('.ok').style.borderColor = 'rgba(52,211,153,.28)';

  return new Promise((resolve) => {
    const inp = overlay.querySelector('input');
    const done = (val) => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector('.cancel').onclick = () => done('');
    overlay.querySelector('.ok').onclick = () => done(String(inp.value || ''));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(String(inp.value || ''));
      if (e.key === 'Escape') done('');
    });
    document.body.appendChild(overlay);
    setTimeout(() => inp.focus(), 0);
  });
}

async function triggerFlash(camId, btn) {
  btn.disabled = true;
  btn.classList.add('on');
  const prev = btn.textContent;
  btn.textContent = 'FLASH…';
  try {
    let pass = sessionStorage.getItem(FLASH_PASS_KEY);
    if (!pass) {
      pass = await ensureFlashPass();
      if (!pass) throw new Error('cancelled');
      sessionStorage.setItem(FLASH_PASS_KEY, pass);
    }

    const secs = getFlashSeconds();
    const urlOn = '/api/cams/' + encodeURIComponent(camId) + '/flash?on=1';
    const r = await fetch(urlOn, { method: 'POST', headers: { 'x-flash-pass': pass } });
    const j = await r.json().catch(() => ({}));

    if (r.status === 401) {
      sessionStorage.removeItem(FLASH_PASS_KEY);
      btn.textContent = 'DENIED';
    } else {
      btn.textContent = r.ok ? ('ON ' + secs + 's') : 'FAIL';

      // Turn it back off after N seconds (camera firmware also has its own auto-off, but this lets us do <10s too).
      if (r.ok) {
        setTimeout(() => {
          const pass2 = sessionStorage.getItem(FLASH_PASS_KEY);
          if (!pass2) return;
          const urlOff = '/api/cams/' + encodeURIComponent(camId) + '/flash?on=0';
          fetch(urlOff, { method: 'POST', headers: { 'x-flash-pass': pass2 } }).catch(() => {});
        }, secs * 1000);
      }
    }
    if (!r.ok) console.warn('flash failed', j);
  } catch (e) {
    btn.textContent = (String(e).includes('cancelled')) ? prev : 'ERR';
    if (!String(e).includes('cancelled')) console.warn('flash error', e);
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.classList.remove('on');
    btn.textContent = prev;
  }, 1100);
}

for (const cam of cams) {
  const dot = el('span', { class: 'dot' });
  const last = el('span', { text: '—' });
  const img = el('img', { alt: displayNameFor(cam) });

  const flashBtn = el('button', { class: 'flashbtn', type: 'button', title: 'Turn on flash for 10s', text: 'Flash' });
  flashBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerFlash(cam.id, flashBtn);
  });

  const overlay = el('div', { class: 'overlay show' }, [
    el('div', { class: 'badge' }, [
      el('span', { text: 'OFFLINE' }),
      el('span', { text: '• waiting for snapshots' }),
    ])
  ]);

  const name = el('div', { class:'name', text: displayNameFor(cam) });
  const status = el('div', { class:'status' }, [dot, last]);
  const head = el('div', { class: 'cardhead' }, [name, status]);

  const frame = el('div', { class: 'frame' }, [img, flashBtn, head, overlay]);

  const card = el('div', { class: 'card' }, [frame]);
  grid.appendChild(card);
  cards.set(cam.id, { dot, last, img, overlay, lastAt: 0, cardEl: card, flashBtn, nameEl: name });
}

let pageStart = 0;

function clampPageStart(n) {
  if (n >= cams.length) return 0;
  if (pageStart < 0) pageStart = 0;
  if (pageStart >= cams.length) pageStart = 0;
  // keep it aligned to n for nicer paging
  pageStart = Math.floor(pageStart / n) * n;
  if (pageStart >= cams.length) pageStart = 0;
}

function updatePager(n) {
  const needPager = cams.length > n;
  pager.style.display = needPager ? '' : 'none';
  if (!needPager) return;

  const shown = cams.slice(pageStart, pageStart + n).map(displayNameFor);
  pageLabel.textContent = shown.join(' • ') || '—';
}

// init view switching now that cards exist
applyView = (n) => {
  setLayoutFor(n);
  clampPageStart(n);

  cams.forEach((cam, i) => {
    const card = cards.get(cam.id)?.cardEl;
    if (!card) return;
    const show = (i >= pageStart) && (i < pageStart + n);
    card.style.display = show ? '' : 'none';
  });

  updatePager(n);

  // update buttons
  for (const b of viewBtns) {
    b.classList.toggle('active', Number(b.dataset.view) === n);
  }

  // update URL without reload
  const u = new URL(location.href);
  u.searchParams.set('view', String(n));
  history.replaceState(null, '', u);
};

// Default view; can be overridden via ?view=1|2|4|6|10
const viewParam = Number(new URLSearchParams(location.search).get('view') || 4);
const view = [1,2,4,6,10].includes(viewParam) ? viewParam : 4;
applyView(view);

viewBtns.forEach(b => b.addEventListener('click', () => {
  pageStart = 0;
  applyView(Number(b.dataset.view));
}));

prevPageBtn.addEventListener('click', () => {
  const n = Number(document.querySelector('.viewbtn.active')?.dataset.view || view);
  pageStart = (pageStart - n);
  if (pageStart < 0) pageStart = Math.max(0, Math.floor((cams.length - 1) / n) * n);
  applyView(n);
});

nextPageBtn.addEventListener('click', () => {
  const n = Number(document.querySelector('.viewbtn.active')?.dataset.view || view);
  pageStart = (pageStart + n);
  if (pageStart >= cams.length) pageStart = 0;
  applyView(n);
});

// Keyboard shortcuts for quick switching: 1/2/4/6/0 (0 => 10)
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

  // paging when not all cams fit
  if (e.key === 'ArrowLeft') prevPageBtn.click();
  if (e.key === 'ArrowRight') nextPageBtn.click();

  if (e.key === '1') { pageStart = 0; applyView(1); }
  if (e.key === '2') { pageStart = 0; applyView(2); }
  if (e.key === '4') { pageStart = 0; applyView(4); }
  if (e.key === '6') { pageStart = 0; applyView(6); }
  if (e.key === '0') { pageStart = 0; applyView(10); }
});

async function poll() {
  const r = await fetch('/api/cams', { cache: 'no-store' });
  const data = await r.json();
  const now = Date.now();
  for (const cam of cams) {
    const c = cards.get(cam.id);
    const m = data[cam.id];
    if (m?.lastAtMs) {
      c.lastAt = m.lastAtMs;
      const age = now - m.lastAtMs;
      const ip = m?.ip ? (' • ' + m.ip) : '';
      c.last.textContent = String(Math.round(age/1000)) + 's ago' + ip;
      const online = age < offlineMs;
      c.dot.className = 'dot ' + (online ? 'ok' : 'bad');
      c.img.src = '/cams/' + cam.id + '.jpg?t=' + now;
      c.overlay.className = 'overlay' + (online ? '' : ' show');
    } else {
      const ip = m?.ip ? (' • ' + m.ip) : '';
      c.last.textContent = 'offline' + ip;
      c.dot.className = 'dot bad';
      c.img.removeAttribute('src');
      c.overlay.className = 'overlay show';
    }
  }
}

function openSettings() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position:'fixed', inset:'0', background:'rgba(0,0,0,.65)', display:'grid', placeItems:'center', zIndex:'9999' });

  const box = document.createElement('div');
  box.style.cssText = 'width:min(520px,94vw);max-height:88vh;overflow:auto;background:rgba(17,24,39,.94);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;box-shadow:0 20px 80px rgba(0,0,0,.55);';

  const title = document.createElement('div');
  title.textContent = 'Settings';
  title.style.cssText = 'font-weight:900;margin-bottom:10px;font-size:16px;';

  const flashRow = document.createElement('div');
  flashRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap;';
  const flashLabel = document.createElement('div');
  flashLabel.textContent = 'Flash seconds';
  flashLabel.style.cssText = 'font-weight:800;';
  const flashInput = document.createElement('input');
  flashInput.type = 'number';
  flashInput.min = '1';
  flashInput.max = '60';
  flashInput.value = String(getFlashSeconds());
  flashInput.style.cssText = 'width:90px;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.28);color:#e5e7eb;outline:none;';
  const flashHint = document.createElement('div');
  flashHint.textContent = 'Note: cameras auto-off at ~10s; shorter works, longer may still turn off at 10s until firmware update.';
  flashHint.style.cssText = 'color:#9ca3af;font-size:12px;';
  flashRow.append(flashLabel, flashInput, flashHint);

  const namesTitle = document.createElement('div');
  namesTitle.textContent = 'Camera names';
  namesTitle.style.cssText = 'font-weight:900;margin:12px 0 8px;';

  const namesWrap = document.createElement('div');
  namesWrap.style.cssText = 'display:grid;gap:8px;';
  const names = getCustomNames();
  const nameInputs = new Map();

  cams.forEach(cam => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center;';
    const k = document.createElement('div');
    k.textContent = cam.id;
    k.style.cssText = 'color:#9ca3af;font-size:12px;';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = cam.name || cam.id;
    inp.value = String(names[cam.id] || '');
    inp.style.cssText = 'width:100%;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.28);color:#e5e7eb;outline:none;';
    nameInputs.set(cam.id, inp);
    row.append(k, inp);
    namesWrap.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:14px;';
  const cancel = document.createElement('button');
  cancel.textContent = 'Close';
  cancel.style.cssText = 'padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,24,39,.65);color:#e5e7eb;cursor:pointer;font-weight:900;';
  const save = document.createElement('button');
  save.textContent = 'Save';
  save.style.cssText = 'padding:9px 12px;border-radius:10px;border:1px solid rgba(52,211,153,.28);background:rgba(52,211,153,.18);color:#e5e7eb;cursor:pointer;font-weight:900;';

  cancel.onclick = () => overlay.remove();
  save.onclick = () => {
    const secs = Math.min(Math.max(Math.round(Number(flashInput.value || '10')), 1), 60);
    localStorage.setItem(LS_FLASH_SECS, String(secs));

    const out = {};
    for (const cam of cams) {
      const v = String(nameInputs.get(cam.id)?.value || '').trim();
      if (v) out[cam.id] = v;
    }
    localStorage.setItem(LS_CAM_NAMES, JSON.stringify(out));

    // Update visible names immediately
    for (const cam of cams) {
      const c = cards.get(cam.id);
      if (c?.nameEl) c.nameEl.textContent = displayNameFor(cam);
    }
    // Update pager label
    const n = Number(document.querySelector('.viewbtn.active')?.dataset.view || view);
    updatePager(n);

    overlay.remove();
  };

  actions.append(cancel, save);

  box.append(title, flashRow, namesTitle, namesWrap, actions);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

settingsBtn.addEventListener('click', openSettings);

setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleString();
}, 1000);

poll();
setInterval(poll, refreshMs);
</script>
</body>
</html>`;
});

app.get('/api/cams', async () => {
  const out = {};
  for (const cam of CAMS) {
    const m = meta.get(cam.id);
    if (m) out[cam.id] = m;
  }
  return out;
});

app.post('/api/cams/:camId/hello', async (req, reply) => {
  const camId = req.params.camId;
  const cam = CAMS.find(c => c.id === camId);
  if (!cam) return reply.code(404).send({ error: 'unknown camId' });

  const key = req.headers['x-pluto-key'];
  if (!key || key !== keys[camId]) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const body = req.body || {};
  const ip = String(body.ip || '');
  const rssi = Number.isFinite(body.rssi) ? body.rssi : undefined;
  const heap = Number.isFinite(body.heap) ? body.heap : undefined;
  const version = body.version ? String(body.version) : undefined;

  const prev = meta.get(camId) || {};
  meta.set(camId, {
    ...prev,
    ip,
    rssi,
    heap,
    version,
    helloAt: nowIso(),
    helloAtMs: Date.now(),
  });

  reply.header('cache-control', 'no-store');
  return { ok: true };
});

app.post('/api/cams/:camId/flash', async (req, reply) => {
  const camId = req.params.camId;
  const cam = CAMS.find(c => c.id === camId);
  if (!cam) return reply.code(404).send({ error: 'unknown camId' });

  // Auth: either ADMIN_TOKEN (?token=) or FLASH_PASS (header)
  const adminToken = process.env.ADMIN_TOKEN;
  const token = String(req.query?.token || '');
  const pass = String(req.headers['x-flash-pass'] || '');

  // If FLASH_PASS is not set, password auth is disabled (ADMIN_TOKEN still works if set)
  const okAuth = (adminToken && token === adminToken) || (FLASH_PASS && pass && pass === FLASH_PASS);
  if (!okAuth) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const m = meta.get(camId);
  const ip = m?.ip;
  if (!ip) return reply.code(409).send({ error: 'no ip known yet (wait for hello)' });

  const on = String(req.query?.on || '1');
  const onVal = (on === '1' || on === 'true' || on === 'on') ? '1' : '0';

  // Relay command to the camera's local web server
  const url = `http://${ip}/flash?on=${onVal}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctrl.signal });
    const text = await r.text().catch(() => '');
    reply.header('cache-control', 'no-store');
    return { ok: r.ok, status: r.status, body: text.slice(0, 200) };
  } catch (e) {
    return reply.code(502).send({ error: 'relay failed', detail: String(e) });
  } finally {
    clearTimeout(t);
  }
});

app.get('/cams/:camId.jpg', async (req, reply) => {
  const camId = req.params.camId;
  const file = path.join(FRAMES_DIR, `${camId}.jpg`);
  try {
    const buf = await fs.readFile(file);
    reply.header('content-type', 'image/jpeg');
    reply.header('cache-control', 'no-store');
    return buf;
  } catch {
    reply.code(404);
    return { error: 'no frame' };
  }
});

app.post('/api/cams/:camId/frame', async (req, reply) => {
  const camId = req.params.camId;
  const cam = CAMS.find(c => c.id === camId);
  if (!cam) return reply.code(404).send({ error: 'unknown camId' });

  const key = req.headers['x-pluto-key'];
  if (!key || key !== keys[camId]) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('image/jpeg')) {
    return reply.code(415).send({ error: 'content-type must be image/jpeg' });
  }

  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100) {
    return reply.code(400).send({ error: 'invalid body' });
  }

  const file = path.join(FRAMES_DIR, `${camId}.jpg`);
  await fs.writeFile(file, buf);

  const prev = meta.get(camId) || {};
  meta.set(camId, { ...prev, lastAt: nowIso(), lastAtMs: Date.now(), bytes: buf.length });

  reply.header('cache-control', 'no-store');
  return { ok: true };
});

app.get('/admin/keys', async (req, reply) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    reply.code(404);
    return { error: 'not found' };
  }
  const token = String(req.query?.token || '');
  if (token !== adminToken) {
    reply.code(401);
    return { error: 'unauthorized' };
  }
  reply.header('cache-control', 'no-store');
  return { cams: CAMS, keys };
});

await app.listen({ port: PORT, host: HOST });
app.log.info({ PORT, HOST, cams: CAMS.map(c => c.id) }, 'plutcam-hub listening');
