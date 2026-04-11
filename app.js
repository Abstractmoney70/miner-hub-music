"use strict";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Token is fetched from main process via IPC (defined in preload.js).
// We NEVER hardcode it here. Falls back to "" in browser/dev mode.
const CONFIG = {
  token:   "",   // populated on init via electronAPI.getToken()
  owner:   "Abstractmoney70",
  repo:    "miner-hub-music",
  codes: {
    "MINECRAFTDAYDOOKIAN1994":   { access: "dookie-early",  limit: 0 },
    "MINECRAFTDAYNIMRODIAN1997": { access: "nimrod-early",  limit: 0 },
  },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  manifest:      null,
  queue:         [],
  queueIndex:    -1,
  shuffleOrder:  [],
  shuffle:       false,
  repeat:        "none",   // "none" | "all" | "one"
  volume:        0.8,
  draggingProg:  false,
  draggingVol:   false,
  colors:        new Map(),
  unlockedTiers: new Set(),
  redemptions:   {},
  localPlayCounts: {},
  youtubeViewCounts: {},
};

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function loadPersisted() {
  try {
    const tiers = JSON.parse(localStorage.getItem("mdh_tiers") || "[]");
    tiers.forEach(t => state.unlockedTiers.add(t));
    state.redemptions = JSON.parse(localStorage.getItem("mdh_redemptions") || "{}");
    state.volume  = parseFloat(localStorage.getItem("mdh_volume")  ?? "0.8");
    state.shuffle = localStorage.getItem("mdh_shuffle") === "true";
    state.repeat  = localStorage.getItem("mdh_repeat")  || "none";
  } catch { /* ignore */ }
}

function savePersisted() {
  localStorage.setItem("mdh_tiers",       JSON.stringify([...state.unlockedTiers]));
  localStorage.setItem("mdh_redemptions", JSON.stringify(state.redemptions));
  localStorage.setItem("mdh_volume",      String(state.volume));
  localStorage.setItem("mdh_shuffle",     String(state.shuffle));
  localStorage.setItem("mdh_repeat",      state.repeat);
}

// ─── ACCESS ───────────────────────────────────────────────────────────────────
function redeemCode(code) {
  const trimmed = code.trim().toUpperCase();
  const entry = CONFIG.codes[trimmed];
  if (!entry) return { ok: false, msg: "Invalid code." };
  const used = state.redemptions[trimmed] || 0;
  if (entry.limit > 0 && used >= entry.limit)
    return { ok: false, msg: "This code has reached its maximum redemptions." };
  if (state.unlockedTiers.has(entry.access))
    return { ok: false, msg: "You already have this access." };
  state.unlockedTiers.add(entry.access);
  state.redemptions[trimmed] = used + 1;
  savePersisted();
  return { ok: true, tier: entry.access };
}

function canAccessTrack(track, album) {
  if ((track.access ?? "public") === "public") return true;
  if (state.unlockedTiers.has(`${album.slug}-early`)) return true;
  if ((album.access ?? "public") === "public") return true;
  return false;
}

function canSeeAlbum(album) {
  const access = album.access ?? "public";
  if (access === "public") return true;
  // "early" albums show as locked teasers — always visible, just gated
  if (access === "early") return true;
  // "locked" albums are fully hidden until unlocked
  if (access === "locked") return state.unlockedTiers.has(`${album.slug}-early`);
  return false;
}

function isAlbumLocked(album) {
  const access = album.access ?? "public";
  if (access === "public") return false;
  return !state.unlockedTiers.has(`${album.slug}-early`);
}

// ─── ELEMENTS ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  page:          $("page"),
  sidebarLib:    $("sidebarLibrary"),
  reloadBtn:     $("reloadBtn"),
  backBtn:       $("backBtn"),
  fwdBtn:        $("fwdBtn"),
  searchInput:   $("searchInput"),
  queueNow:      $("queueNow"),
  queueList:     $("queueList"),
  clearQueueBtn: $("clearQueueBtn"),
  barCover:      $("barCover"),
  barCoverPh:    $("barCoverPlaceholder"),
  barTitle:      $("barTitle"),
  barArtist:     $("barArtist"),
  barLike:       $("barLike"),
  timeNow:       $("timeNow"),
  timeDur:       $("timeDur"),
  progressRail:  $("progressRail"),
  progressFill:  $("progressFill"),
  progressThumb: $("progressThumb"),
  playBtn:       $("playBtn"),
  prevBtn:       $("prevBtn"),
  nextBtn:       $("nextBtn"),
  shuffleBtn:    $("shuffleBtn"),
  repeatBtn:     $("repeatBtn"),
  volRail:       $("volRail"),
  volFill:       $("volFill"),
  volThumb:      $("volThumb"),
  audio:         $("audio"),
  queueToggle:   $("queueToggleBtn"),
  queuePanel:    $("queuePanel"),
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function fmtPlays(n) { return n == null ? "—" : Number(n).toLocaleString("en-US"); }
function parseDur(str) {
  if (!str || !str.includes(":")) return 0;
  const [m, s] = str.split(":").map(Number);
  return m * 60 + (s || 0);
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseYouTubeVideoId(track) {
  const rawId = track.youtubeVideoId ?? track.youtubeId ?? "";
  if (rawId) return String(rawId).trim();

  const rawUrl = track.youtubeUrl ?? track.youtube ?? "";
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace(/\//g, "").trim() || null;
    }
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v") || null;
    }
  } catch { /* ignore malformed URLs */ }

  return null;
}

function getTrackPlayCount(track) {
  const youtubeViews = state.youtubeViewCounts[track.id];
  const baseCount = Number.isFinite(youtubeViews) ? youtubeViews : track.plays;
  const localCount = Number(state.localPlayCounts[track.id]) || 0;

  if (baseCount == null) return localCount > 0 ? localCount : null;
  return Number(baseCount) + localCount;
}

function albumTotalDuration(album) {
  const totalSec = (album.tracks ?? []).reduce((sum, t) => sum + parseDur(t.duration ?? ""), 0);
  if (totalSec <= 0) return null;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return s > 0 ? `${m} min ${s} sec` : `${m} min`;
  return `${s} sec`;
}


function downloadFilename(track) {
  const artist = String(track.artist || "Minecraft Day").trim();
  const title = String(track.title || "Track").trim();
  return `${artist} - ${title}.mp3`;
}

// ─── GITHUB / MANIFEST FETCH ──────────────────────────────────────────────────
async function fetchManifest() {
  // Local first (works in dev and when bundled)
  try {
    const res = await fetch(`./releases.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) return res.json();
  } catch { /* fall through */ }

  // GitHub API fallback
  if (!CONFIG.token) throw new Error("No local releases.json and no GitHub token.");
  const headers = {
    "Accept":        "application/vnd.github+json",
    "Authorization": `Bearer ${CONFIG.token}`,
  };
  const res = await fetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/releases.json`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  return JSON.parse(atob(data.content.replace(/\n/g, "")));
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
function albums()        { return state.manifest?.albums ?? []; }
function visibleAlbums() { return albums().filter(canSeeAlbum); }
function albumBySlug(s)  { return albums().find(a => a.slug === s) ?? null; }

function normTrack(t, album, i) {
  return {
    id:         `${album.slug}::${i}`,
    title:      t.title,
    file:       t.file ?? "",
    duration:   t.duration ?? "",
    artist:     t.artist ?? album.artist ?? "Minecraft Day",
    plays:      t.plays ?? null,
    explicit:   Boolean(t.explicit),
    access:     t.access ?? "public",
    albumName:  album.name,
    albumYear:  album.year,
    albumSlug:  album.slug,
    cover:      album.cover ?? "",
    trackIndex: i,
    youtubeVideoId: t.youtubeVideoId ?? t.youtubeId ?? "",
    youtubeUrl: t.youtubeUrl ?? t.youtube ?? "",
  };
}

function albumTracks(album)    { return (album.tracks ?? []).map((t, i) => normTrack(t, album, i)); }
function playableTracks(album) { return albumTracks(album).filter(t => canAccessTrack(t, album) && t.file); }
function allTracks()           { return albums().flatMap(albumTracks); }
function trackById(id)         { return allTracks().find(t => t.id === id) ?? null; }
function currentTrack()        { return state.queue[state.queueIndex] ?? null; }

// ─── ROUTING ──────────────────────────────────────────────────────────────────
function route() {
  const hash  = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "albums") return { name: "albums" };
  if (parts[0] === "search") return { name: "search", q: decodeURIComponent(parts.slice(1).join("/") || "") };
  if (parts[0] === "album" && parts[1]) return { name: "album", slug: decodeURIComponent(parts[1]) };
  return { name: "home" };
}

function syncNav() {
  const r = route();
  document.querySelectorAll(".nav-item").forEach(a => {
    const dr = a.dataset.route;
    a.classList.toggle("is-active",
      (dr === "home"   && r.name === "home")   ||
      (dr === "albums" && (r.name === "albums" || r.name === "album")) ||
      (dr === "search" && r.name === "search")
    );
  });
}

// ─── COLOR EXTRACTION ─────────────────────────────────────────────────────────
async function extractColor(album) {
  if (!album.cover || state.colors.has(album.slug)) return;
  await new Promise(res => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 10;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 10, 10);
        const d = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
        state.colors.set(album.slug,
          `rgba(${Math.min(255, Math.round(r/n*1.3))},${Math.min(255, Math.round(g/n*0.5))},${Math.min(255, Math.round(b/n*0.5))},0.95)`
        );
      } catch { state.colors.set(album.slug, "rgba(30,30,30,0.95)"); }
      res();
    };
    img.onerror = () => { state.colors.set(album.slug, "rgba(30,30,30,0.95)"); res(); };
    img.src = album.cover;
  });
}

async function primeColors() {
  await Promise.all(albums().map(extractColor));
  renderPage();
}

// ─── ACCESS MODAL ─────────────────────────────────────────────────────────────
function showAccessModal(album) {
  document.getElementById("accessModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "accessModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.8);display:grid;place-items:center;z-index:999;backdrop-filter:blur(6px);";
  modal.innerHTML = `
    <div style="background:#161616;border:1px solid rgba(255,255,255,0.13);border-radius:14px;padding:32px;width:420px;max-width:92vw;display:flex;flex-direction:column;gap:20px;">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:0.04em;margin-bottom:6px">🔒 Early Access</div>
        <div style="color:var(--text-2);font-size:0.88rem"><strong style="color:white">${esc(album.name)}</strong> requires an early access code.</div>
      </div>
      <input id="accessCodeInput" type="text" placeholder="Enter your code..."
        style="background:#1e1e1e;border:1px solid rgba(255,255,255,0.13);border-radius:8px;padding:12px 14px;font-size:0.9rem;color:white;outline:none;width:100%;font-family:'DM Mono',monospace;letter-spacing:0.06em;text-transform:uppercase;"/>
      <div id="accessCodeMsg" style="font-size:0.78rem;min-height:18px;color:var(--text-3)"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="accessCancelBtn" style="background:transparent;border:1px solid rgba(255,255,255,0.13);border-radius:999px;padding:9px 20px;font-size:0.82rem;font-weight:700;color:var(--text-2);cursor:pointer;">Cancel</button>
        <button id="accessSubmitBtn" style="background:var(--green);color:#000;border:none;border-radius:999px;padding:9px 24px;font-size:0.82rem;font-weight:700;cursor:pointer;">Unlock</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  const input = document.getElementById("accessCodeInput");
  const msg   = document.getElementById("accessCodeMsg");
  input.focus();

  const close = () => modal.remove();
  document.getElementById("accessCancelBtn").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  const tryRedeem = () => {
    const result = redeemCode(input.value);
    if (result.ok) {
      msg.style.color = "var(--green)";
      msg.textContent = "✓ Unlocked! Enjoy the album.";
      setTimeout(() => { close(); renderSidebar(); renderPage(); }, 700);
    } else {
      msg.style.color = "#e84040";
      msg.textContent = result.msg;
      input.style.borderColor = "rgba(232,64,64,0.5)";
      setTimeout(() => input.style.borderColor = "", 1200);
    }
  };

  document.getElementById("accessSubmitBtn").addEventListener("click", tryRedeem);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter")  tryRedeem();
    if (e.key === "Escape") close();
  });
}

function showVersionsModal(currentAlbum, versions) {
  document.getElementById("versionsModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "versionsModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.8);display:grid;place-items:center;z-index:999;backdrop-filter:blur(6px);";
  modal.innerHTML = `
    <div style="background:#161616;border:1px solid rgba(255,255,255,0.13);border-radius:14px;padding:28px;width:480px;max-width:92vw;display:flex;flex-direction:column;gap:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:0.04em">Other versions of "${esc(currentAlbum.name)}"</div>
        <button id="versionsCloseBtn" style="color:var(--text-3);font-size:1.2rem;padding:4px 8px;border-radius:6px;background:transparent;border:none;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${versions.map(a => `
          <a href="#/album/${encodeURIComponent(a.slug)}" id="versionLink_${esc(a.slug)}"
            style="display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:10px;background:#1e1e1e;border:1px solid rgba(255,255,255,0.07);cursor:pointer;text-decoration:none;color:inherit;transition:background 0.15s;">
            ${a.cover
              ? `<img src="${esc(a.cover)}" style="width:52px;height:52px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
              : `<div style="width:52px;height:52px;border-radius:6px;background:#282828;display:grid;place-items:center;font-size:1.4rem;flex-shrink:0;">⛏</div>`
            }
            <div>
              <div style="font-weight:600;margin-bottom:3px">${esc(a.name)}</div>
              <div style="color:var(--text-3);font-size:0.8rem">${esc(a.type ?? "Album")} · ${esc(a.year)}${a.description ? ` · ${esc(a.description)}` : ""}</div>
            </div>
          </a>
        `).join("")}
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById("versionsCloseBtn").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  // Close on navigation
  versions.forEach(a => {
    document.getElementById(`versionLink_${a.slug}`)?.addEventListener("click", close);
  });
}


function renderSidebar() {
  const list = visibleAlbums();
  if (!list.length) {
    el.sidebarLib.innerHTML = `<div style="padding:16px;color:var(--text-3);font-size:0.82rem">No albums loaded.</div>`;
    return;
  }
  el.sidebarLib.innerHTML = list.map(a => {
    const locked = isAlbumLocked(a);
    return `
      <a class="lib-album" href="#/album/${encodeURIComponent(a.slug)}">
        ${a.cover
          ? `<img class="lib-album__art" src="${esc(a.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
          : `<div class="lib-album__art" style="display:grid;place-items:center;font-size:1.2rem">⛏</div>`
        }
        <div>
          <div class="lib-album__name">${locked ? "🔒 " : ""}${esc(a.name)}</div>
          <div class="lib-album__meta">${esc(a.type ?? "Album")} · ${esc(a.year)}</div>
        </div>
      </a>`;
  }).join("");
}

// ─── RENDER HELPERS ───────────────────────────────────────────────────────────
function renderAlbumCard(a) {
  const locked = isAlbumLocked(a);
  return `
    <a class="album-card ${locked ? "album-card--locked" : ""}" href="#/album/${encodeURIComponent(a.slug)}">
      <div class="album-card__art">
        ${a.cover
          ? `<img class="album-card__img" src="${esc(a.cover)}" alt="${esc(a.name)}" loading="lazy" onerror="this.outerHTML='<div class=album-card__img-placeholder>⛏</div>'">`
          : `<div class="album-card__img-placeholder">⛏</div>`
        }
        ${locked
          ? `<div class="album-card__lock-overlay"><span class="album-card__lock-icon">🔒</span><span class="album-card__lock-label">Early Access</span></div>`
          : `<button class="album-card__play" data-action="play-album" data-slug="${esc(a.slug)}">▶</button>`
        }
      </div>
      <div class="album-card__name">${esc(a.name)}</div>
      <div class="album-card__year">${esc(a.type ?? "Album")} · ${esc(a.year)}</div>
    </a>`;
}

function renderTrackRow(track, i, album) {
  const playing    = currentTrack()?.id === track.id;
  const accessible = canAccessTrack(track, album ?? albumBySlug(track.albumSlug));
  return `
    <div class="track-row ${playing ? "is-playing" : ""} ${!accessible ? "track-row--locked" : ""}"
      data-track-id="${esc(track.id)}">
      <div class="track-row__num">
        ${playing
          ? `<span style="color:var(--green)">▶</span>`
          : accessible && track.file
            ? `<button class="track-row__play-btn" data-action="play-track" data-track-id="${esc(track.id)}" title="Play">${i + 1}</button>`
            : `<span>${i + 1}</span>`
        }
      </div>
      <div>
        <div class="track-row__title">${!accessible ? `<span style="color:var(--text-3)">🔒 </span>` : ""}${esc(track.title)}</div>
        <div class="track-row__artist">
          ${track.explicit ? `<span class="badge-e">E</span>` : ""}
          ${esc(track.artist)}
          ${!accessible && track.access === "early" ? `<span style="color:var(--amber);font-size:0.7rem;font-weight:700;margin-left:4px">EARLY</span>` : ""}
        </div>
      </div>
      <div class="track-row__plays">${fmtPlays(getTrackPlayCount(track))}</div>
      <div class="track-row__dur">${esc(track.duration || "—")}</div>
    </div>`;
}

// ─── PAGE RENDERS ─────────────────────────────────────────────────────────────
function renderHome() {
  const list     = visibleAlbums();
  const featured = list.find(a => !isAlbumLocked(a)) ?? list[0];
  const color    = featured ? (state.colors.get(featured.slug) ?? "rgba(40,40,40,0.9)") : "rgba(40,40,40,0.9)";

  el.page.innerHTML = `
    ${featured ? `
    <section class="hero" style="--hero-color:${esc(color)}">
      <div class="hero__bg"></div>
      <div class="hero__noise"></div>
      <div class="hero__content">
        ${featured.cover
          ? `<img class="hero__cover" src="${esc(featured.cover)}" alt="${esc(featured.name)}" onerror="this.outerHTML='<div class=hero__cover-placeholder>⛏</div>'">`
          : `<div class="hero__cover-placeholder">⛏</div>`
        }
        <div>
          <div class="hero__label">Featured · Noteblock Cover</div>
          <h2 class="hero__title">${esc(featured.name)}</h2>
          <p class="hero__meta"><strong>${esc(featured.artist ?? "Minecraft Day")}</strong> · ${esc(featured.year)} · ${featured.tracks?.length ?? 0} tracks</p>
          <div class="hero__actions">
            <button class="btn-green" data-action="play-album" data-slug="${esc(featured.slug)}">▶ Play</button>
            <button class="btn-outline" data-action="shuffle-album" data-slug="${esc(featured.slug)}">⇄ Shuffle</button>
            <a class="btn-outline" href="#/album/${encodeURIComponent(featured.slug)}">View album</a>
          </div>
        </div>
      </div>
    </section>` : `<div class="page-empty">No albums loaded.</div>`}

    <div class="strip">
      <div class="strip__header">
        <div class="strip__title">All Albums</div>
        <a class="strip__link" href="#/albums">See all</a>
      </div>
      <div class="album-grid">${list.map(renderAlbumCard).join("")}</div>
    </div>

    ${state.unlockedTiers.size === 0 ? `
    <div class="strip">
      <div style="background:#161616;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <div style="font-weight:700;margin-bottom:4px">🔑 Have an early access code?</div>
          <div style="color:var(--text-3);font-size:0.85rem">Unlock albums before they drop on YouTube.</div>
        </div>
        <button class="btn-outline" id="openCodeBtn" style="flex-shrink:0">Enter code</button>
      </div>
    </div>` : ""}
  `;

  document.getElementById("openCodeBtn")?.addEventListener("click", () => {
    showAccessModal({ name: "Early Access Content", slug: "__generic__", access: "early" });
  });

  bindPageEvents();
}

function renderAlbums() {
  el.page.innerHTML = `
    <div class="strip" style="padding-top:28px">
      <div class="strip__header"><div class="strip__title">Albums</div></div>
      <div class="album-grid">${visibleAlbums().map(renderAlbumCard).join("")}</div>
    </div>`;
  bindPageEvents();
}

function renderAlbumPage(slug) {
  const album = albumBySlug(slug);
  if (!album) { el.page.innerHTML = `<div class="page-empty">Album not found.</div>`; return; }

  const locked = isAlbumLocked(album);
  if (locked) {
    el.page.innerHTML = `
      <div class="page-empty" style="flex-direction:column;gap:16px;height:60vh">
        <div style="font-size:3rem">🔒</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:0.04em">${esc(album.name)}</div>
        <div style="color:var(--text-3);font-size:0.9rem">This album requires early access.</div>
        ${album.description ? `<div style="color:var(--text-2);font-size:0.85rem;max-width:360px;text-align:center">${esc(album.description)}</div>` : ""}
        <button class="btn-green" id="unlockAlbumBtn">🔑 Enter Access Code</button>
      </div>`;
    document.getElementById("unlockAlbumBtn")?.addEventListener("click", () => showAccessModal(album));
    return;
  }

  const tracks = albumTracks(album);
  const color  = state.colors.get(slug) ?? "rgba(30,30,30,0.95)";
  const others = visibleAlbums().filter(a => a.slug !== slug);

  // Find albums with the exact same name (duplicate versions)
  const sameNameAlbums = visibleAlbums().filter(
    a => a.slug !== slug && a.name.trim().toLowerCase() === album.name.trim().toLowerCase()
  );

  el.page.innerHTML = `
    <div class="album-hero">
      <div class="album-hero__bg"><div class="album-hero__bg-inner" style="--album-color:${esc(color)}"></div></div>
      <div class="album-hero__content">
        ${album.cover
          ? `<img class="album-hero__cover" src="${esc(album.cover)}" alt="${esc(album.name)}" onerror="this.outerHTML='<div class=album-hero__cover-placeholder>⛏</div>'">`
          : `<div class="album-hero__cover-placeholder">⛏</div>`
        }
        <div>
          <div class="album-hero__type">${esc(album.type ?? "Album")} · Noteblock Cover</div>
          <h2 class="album-hero__title">${esc(album.name)}</h2>
          <p class="album-hero__meta"><strong>${esc(album.artist ?? "Minecraft Day")}</strong> · ${esc(album.year)} · ${tracks.length} tracks${albumTotalDuration(album) ? ` · ${albumTotalDuration(album)}` : ""}</p>
        </div>
      </div>
    </div>

    <div class="album-toolbar">
      <button class="play-btn-big" data-action="play-album" data-slug="${esc(slug)}">▶</button>
      <button class="btn-outline" data-action="shuffle-album" data-slug="${esc(slug)}">⇄ Shuffle</button>
    </div>

    <div class="track-table">
      <div class="track-table__head">
        <div>#</div><div>Title</div>
        <div style="text-align:right">Plays</div>
        <div style="text-align:right">⏱</div>
      </div>
      <div id="trackList">
        ${tracks.map((t, i) => renderTrackRow(t, i, album)).join("")}
      </div>
    </div>

    ${sameNameAlbums.length ? `
    <div class="more-versions-bar">
      <button class="btn-outline" id="moreVersionsBtn">
        ${sameNameAlbums.length} more release${sameNameAlbums.length > 1 ? "s" : ""} of "${esc(album.name)}"
      </button>
    </div>` : ""}

    ${others.filter(a => a.name.trim().toLowerCase() !== album.name.trim().toLowerCase()).length ? `
    <div class="more-strip">
      <div class="strip__header">
        <div class="strip__title">More by Minecraft Day</div>
        <a class="strip__link" href="#/albums">See all</a>
      </div>
      <div class="album-grid">${others.filter(a => a.name.trim().toLowerCase() !== album.name.trim().toLowerCase()).slice(0, 6).map(renderAlbumCard).join("")}</div>
    </div>` : ""}
  `;
  bindPageEvents();

  // Wire up the "more versions" button
  document.getElementById("moreVersionsBtn")?.addEventListener("click", () => {
    showVersionsModal(album, sameNameAlbums);
  });
}

function renderSearch(q) {
  const query = q.trim().toLowerCase();
  if (!query) {
    el.page.innerHTML = `
      <div class="search-page">
        <div class="search-page__hero">
          <div class="search-page__title">Search</div>
          <div class="search-page__sub">Find albums and tracks in the Miner Day archive.</div>
        </div>
        <div class="strip__header" style="margin-bottom:12px"><div class="strip__title">Browse Albums</div></div>
        <div class="album-grid">${visibleAlbums().map(renderAlbumCard).join("")}</div>
      </div>`;
    bindPageEvents(); return;
  }

  const matchedAlbums = visibleAlbums().filter(a =>
    `${a.name} ${a.year} ${a.artist} ${a.type}`.toLowerCase().includes(query));

  const matchedTracks = visibleAlbums().flatMap(a =>
    albumTracks(a)
      .filter(t => `${t.title} ${t.artist} ${t.albumName}`.toLowerCase().includes(query))
      .map(t => ({ t, a })));

  el.page.innerHTML = `
    <div class="search-page">
      <div class="search-page__hero">
        <div class="search-page__title">Results for "${esc(q)}"</div>
        <div class="search-page__sub">${matchedAlbums.length + matchedTracks.length} results</div>
      </div>
      ${matchedAlbums.length ? `
        <div class="search-section">
          <div class="search-results__label">Albums</div>
          <div class="album-grid">${matchedAlbums.map(renderAlbumCard).join("")}</div>
        </div>` : ""}
      ${matchedTracks.length ? `
        <div class="search-section">
          <div class="search-results__label">Tracks</div>
          <div id="trackList">${matchedTracks.map(({ t, a }, i) => renderTrackRow(t, i, a)).join("")}</div>
        </div>` : ""}
      ${!matchedAlbums.length && !matchedTracks.length
        ? `<div class="page-empty" style="height:200px">No results for "${esc(q)}"</div>` : ""}
    </div>`;
  bindPageEvents();
}

function renderPage() {
  const r = route();
  syncNav();
  el.backBtn.disabled = history.length <= 1;
  if (r.name === "albums") { renderAlbums(); return; }
  if (r.name === "album")  { renderAlbumPage(r.slug); return; }
  if (r.name === "search") { renderSearch(r.q); return; }
  renderHome();
}

// ─── CONTEXT MENU ─────────────────────────────────────────────────────────────
function showContextMenu(x, y, items) {
  document.getElementById("mdhCtxMenu")?.remove();
  const menu = document.createElement("div");
  menu.id = "mdhCtxMenu";
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#1a1a1a;border:1px solid rgba(255,255,255,0.13);border-radius:10px;padding:5px;z-index:9998;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.6);`;
  menu.innerHTML = items.map(item =>
    item === "---"
      ? `<div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0;"></div>`
      : `<button class="ctx-item" data-ctx="${item.action}" style="display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;font-size:0.84rem;border-radius:6px;background:transparent;border:none;color:${item.danger ? "#e84040" : "white"};cursor:pointer;text-align:left;transition:background 0.1s;">
          <span style="opacity:0.7;font-size:0.9rem;">${item.icon}</span>${esc(item.label)}
        </button>`
  ).join("");
  document.body.appendChild(menu);

  // Clamp to viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  menu.style.left = `${x - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top  = `${y - rect.height}px`;

  menu.querySelectorAll(".ctx-item").forEach(btn => {
    btn.addEventListener("mouseenter", () => btn.style.background = "rgba(255,255,255,0.07)");
    btn.addEventListener("mouseleave", () => btn.style.background = "transparent");
    btn.addEventListener("click", () => {
      menu.remove();
      const action = btn.dataset.ctx;
      if (typeof window._ctxHandlers?.[action] === "function") window._ctxHandlers[action]();
    });
  });

  const dismiss = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", dismiss); } };
  setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
}

// ─── PAGE EVENT BINDING ───────────────────────────────────────────────────────
function bindPageEvents() {
  // ── Album play/shuffle buttons (toolbar & hero) ──
  el.page.querySelectorAll("[data-action='play-album']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      const a = albumBySlug(btn.dataset.slug);
      if (a) { if (isAlbumLocked(a)) { showAccessModal(a); return; } playAlbum(a, 0, false); }
    });
  });
  el.page.querySelectorAll("[data-action='shuffle-album']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const a = albumBySlug(btn.dataset.slug);
      if (a) { if (isAlbumLocked(a)) { showAccessModal(a); return; } playAlbum(a, 0, true); }
    });
  });

  // ── Track: click number button or row to play ──
  el.page.querySelectorAll("[data-action='play-track']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const t = trackById(btn.dataset.trackId);
      if (t) playTrackNow(t);
    });
  });
  el.page.querySelectorAll(".track-row:not(.track-row--locked)").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("[data-action='play-track']")) return; // handled above
      const t = trackById(row.dataset.trackId);
      if (t?.file) playTrackNow(t);
    });
    row.addEventListener("dblclick", e => {
      const t = trackById(row.dataset.trackId);
      if (t?.file) playTrackNow(t);
    });

    // Right-click context menu on track
    row.addEventListener("contextmenu", e => {
      e.preventDefault();
      const t = trackById(row.dataset.trackId);
      if (!t) return;
      window._ctxHandlers = {
        "queue":    () => { state.queue.push(t); renderQueue(); showToast(`Queued: ${t.title}`); },
        "download": () => { if (t.file) downloadTrack(t); },
      };
      showContextMenu(e.clientX, e.clientY, [
        { action: "queue",    icon: "☰", label: "Add to queue" },
        { action: "download", icon: "⬇", label: "Download" },
      ]);
    });
  });

  // Locked track rows — right-click to unlock
  el.page.querySelectorAll(".track-row--locked").forEach(row => {
    row.addEventListener("contextmenu", e => {
      e.preventDefault();
      const t = trackById(row.dataset.trackId);
      if (!t) return;
      window._ctxHandlers = {
        "unlock": () => { const a = albumBySlug(t.albumSlug); if (a) showAccessModal(a); },
      };
      showContextMenu(e.clientX, e.clientY, [
        { action: "unlock", icon: "🔑", label: "Unlock early access" },
      ]);
    });
  });

  // ── Album cards: click navigates, right-click shows menu ──
  el.page.querySelectorAll(".album-card:not(.album-card--locked)").forEach(card => {
    card.addEventListener("contextmenu", e => {
      e.preventDefault();
      const slug = card.getAttribute("href")?.replace(/#\/album\//,"");
      if (!slug) return;
      const a = albumBySlug(decodeURIComponent(slug));
      if (!a) return;
      window._ctxHandlers = {
        "play":    () => playAlbum(a, 0, false),
        "shuffle": () => playAlbum(a, 0, true),
        "queue":   () => { queueAlbum(a); renderQueue(); showToast(`Queued: ${a.name}`); },
      };
      showContextMenu(e.clientX, e.clientY, [
        { action: "play",    icon: "▶", label: "Play" },
        { action: "shuffle", icon: "⇄", label: "Shuffle play" },
        "---",
        { action: "queue",   icon: "☰", label: "Add to queue" },
      ]);
    });
  });

  // Locked album cards → access modal on click
  el.page.querySelectorAll(".album-card--locked").forEach(card => {
    card.addEventListener("click", e => {
      e.preventDefault();
      const slug = card.getAttribute("href")?.replace(/#\/album\//, "");
      if (slug) { const a = albumBySlug(decodeURIComponent(slug)); if (a) showAccessModal(a); }
    });
  });
}

// ─── QUEUE RENDER ─────────────────────────────────────────────────────────────
function renderQueue() {
  const ct = currentTrack();
  el.queueNow.innerHTML = ct ? `
    <div class="queue__now-inner">
      ${ct.cover
        ? `<img class="queue__now-art" src="${esc(ct.cover)}" alt="">`
        : `<div class="queue__now-art" style="display:grid;place-items:center">⛏</div>`
      }
      <div>
        <div class="queue__now-title">${esc(ct.title)}</div>
        <div class="queue__now-album">${esc(ct.albumName)} · ${esc(ct.artist)}</div>
      </div>
    </div>`
    : `<div style="color:var(--text-3);font-size:0.8rem;padding:4px">Nothing playing</div>`;

  if (!state.queue.length) {
    el.queueList.innerHTML = `<div class="queue__empty">Queue is empty.<br>Play an album to start.</div>`;
    return;
  }

  // When shuffle is on, display tracks in shuffle order so the user sees
  // what's actually coming up next in the correct sequence.
  const displayOrder = (state.shuffle && state.shuffleOrder.length === state.queue.length)
    ? state.shuffleOrder
    : state.queue.map((_, i) => i);

  el.queueList.innerHTML = displayOrder.map((queueIdx, displayPos) => {
    const t = state.queue[queueIdx];
    const isCurrent = queueIdx === state.queueIndex;
    return `
    <div class="queue-item ${isCurrent ? "is-active" : ""}" data-qi="${queueIdx}">
      <div class="queue-item__num">${isCurrent ? "▶" : displayPos + 1}</div>
      <div class="queue-item__info">
        <div class="queue-item__title">${esc(t.title)}</div>
        <div class="queue-item__album">${esc(t.albumName)}</div>
      </div>
      <div class="queue-item__actions">
        <button class="queue-item-btn" data-qi-action="play"   data-qi="${queueIdx}" title="Play">▶</button>
        <button class="queue-item-btn" data-qi-action="up"     data-qi="${queueIdx}" title="Move up">↑</button>
        <button class="queue-item-btn" data-qi-action="down"   data-qi="${queueIdx}" title="Move down">↓</button>
        <button class="queue-item-btn" data-qi-action="remove" data-qi="${queueIdx}" title="Remove">✕</button>
      </div>
    </div>`;
  }).join("");

  el.queueList.querySelectorAll("[data-qi-action]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const i = Number(btn.dataset.qi), action = btn.dataset.qiAction;
      if (action === "play")        { playQueueIndex(i); renderPage(); }
      else if (action === "remove") removeFromQueue(i);
      else                          moveInQueue(i, action === "up" ? i - 1 : i + 1);
      renderQueue();
    });
  });

  el.queueList.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

// ─── PLAYBACK ─────────────────────────────────────────────────────────────────
function buildShuffleOrder(length, currentIdx) {
  const indices = Array.from({ length }, (_, i) => i).filter(i => i !== currentIdx);
  return currentIdx >= 0 ? [currentIdx, ...shuffleArr(indices)] : shuffleArr(indices);
}

function playAlbum(album, startIdx, doShuffle) {
  const tracks = playableTracks(album);
  if (!tracks.length) { showToast("No playable tracks yet", true); return; }
  state.queue = [...tracks];
  state.queueIndex = -1;
  if (doShuffle) {
    state.shuffle = true;
    updateShuffleBtn();
    savePersisted();
    state.shuffleOrder = buildShuffleOrder(tracks.length, 0);
    playQueueIndex(state.shuffleOrder[0]);
  } else {
    playQueueIndex(clamp(startIdx, 0, tracks.length - 1));
  }
}

function queueAlbum(album) {
  state.queue.push(...playableTracks(album));
}

function playTrackNow(track) {
  const at = state.queueIndex >= 0 ? state.queueIndex + 1 : 0;
  state.queue.splice(at, 0, track);
  if (state.shuffle) state.shuffleOrder = buildShuffleOrder(state.queue.length, at);
  playQueueIndex(at);
  renderPage();
}


async function playQueueIndex(i) {
  const t = state.queue[i];
  if (!t) return;
  state.queueIndex = i;

  // Reset the 80% play counter for this new track
  resetPlayTracking(t.id);

  if (t.file) {
    el.audio.src = t.file;
    try { await el.audio.play(); }
    catch (err) { console.error(err); showToast("Couldn't play this track", true); }
  }
  updateBar();
  renderQueue();
}

// ─── SHUFFLE ──────────────────────────────────────────────────────────────────
// Builds a play order that always starts at currentIdx, then visits every
// other index exactly once in random order.
function getShuffledNext() {
  const pos = state.shuffleOrder.indexOf(state.queueIndex);
  const nextPos = pos + 1;
  if (nextPos >= state.shuffleOrder.length) return null; // end of shuffle
  return state.shuffleOrder[nextPos];
}

function getShuffledPrev() {
  const pos = state.shuffleOrder.indexOf(state.queueIndex);
  return pos > 0 ? state.shuffleOrder[pos - 1] : null;
}

// ─── NEXT / PREV ──────────────────────────────────────────────────────────────
function playNext() {
  if (!state.queue.length) return;

  // Repeat one — restart current track, reset play tracking
  if (state.repeat === "one") {
    el.audio.currentTime = 0;
    resetPlayTracking(currentTrack()?.id ?? null);
    el.audio.play().catch(console.error);
    return;
  }

  let nextIdx;
  if (state.shuffle) {
    nextIdx = getShuffledNext();
    if (nextIdx === null) {
      if (state.repeat === "all") {
        // Re-shuffle and loop
        state.shuffleOrder = buildShuffleOrder(state.queue.length, -1);
        nextIdx = state.shuffleOrder[0];
      } else {
        el.audio.pause();
        updateBar();
        return;
      }
    }
  } else {
    nextIdx = state.queueIndex + 1;
    if (nextIdx >= state.queue.length) {
      if (state.repeat === "all") {
        nextIdx = 0;
      } else {
        el.audio.pause();
        updateBar();
        return;
      }
    }
  }

  playQueueIndex(nextIdx);
  renderPage();
}

function playPrev() {
  // If we're more than 3s in, restart the current track
  if (el.audio.currentTime > 3) {
    el.audio.currentTime = 0;
    return;
  }

  let prevIdx;
  if (state.shuffle) {
    prevIdx = getShuffledPrev();
    if (prevIdx === null) {
      // At the start of shuffle — just restart current
      el.audio.currentTime = 0;
      return;
    }
  } else {
    prevIdx = state.queueIndex - 1;
    if (prevIdx < 0) {
      if (state.repeat === "all") {
        prevIdx = state.queue.length - 1;
      } else {
        el.audio.currentTime = 0;
        return;
      }
    }
  }

  playQueueIndex(prevIdx);
  renderPage();
}

function removeFromQueue(i) {
  const wasCurrent = i === state.queueIndex;
  state.queue.splice(i, 1);
  if (!state.queue.length) { clearQueue(); return; }
  if (wasCurrent) { playQueueIndex(Math.min(i, state.queue.length - 1)); return; }
  if (i < state.queueIndex) state.queueIndex--;
  if (state.shuffle) state.shuffleOrder = buildShuffleOrder(state.queue.length, state.queueIndex);
}

function moveInQueue(from, to) {
  if (to < 0 || to >= state.queue.length) return;
  const [item] = state.queue.splice(from, 1);
  state.queue.splice(to, 0, item);
  if (state.queueIndex === from)                   state.queueIndex = to;
  else if (from < state.queueIndex && to >= state.queueIndex) state.queueIndex--;
  else if (from > state.queueIndex && to <= state.queueIndex) state.queueIndex++;
  if (state.shuffle) state.shuffleOrder = buildShuffleOrder(state.queue.length, state.queueIndex);
}

function clearQueue() {
  state.queue = []; state.queueIndex = -1; state.shuffleOrder = [];
  el.audio.pause(); el.audio.removeAttribute("src");
  updateBar(); renderQueue(); renderPage();
}

function downloadTrack(track) {
  if (!window.electronAPI?.downloadTrack) {
    showToast("Downloads only work inside the desktop app.", true);
    return;
  }

  window.electronAPI.downloadTrack({
    url: track.file,
    filename: downloadFilename(track),
  }).then(() => {
    showToast(`Downloading to Downloads: ${track.title}`);
  }).catch(err => {
    console.error(err);
    showToast(`Couldn't download ${track.title}`, true);
  });
}

async function countLocalPlay(track) {
  if (!window.electronAPI?.incrementLocalPlay || !track?.id) return;
  try {
    const nextCount = await window.electronAPI.incrementLocalPlay(track.id);
    state.localPlayCounts[track.id] = Number(nextCount) || 0;
    renderQueue();
    renderPage();
    updateBar();
  } catch (err) {
    console.error("Couldn't persist local play count:", err);
  }
}

// ─── NOW PLAYING BAR ──────────────────────────────────────────────────────────
function updateBar() {
  const t = currentTrack();
  if (!t) {
    el.barTitle.textContent  = "Nothing playing";
    el.barArtist.textContent = "—";
    el.barCover.style.opacity = "0";
    el.barCoverPh.style.opacity = "1";
    el.playBtn.innerHTML = "▶";
    el.timeNow.textContent = "0:00";
    el.timeDur.textContent = "0:00";
    setProgress(0);
    document.title = "Miner Day Hub";
    return;
  }
  el.barTitle.textContent  = t.title;
  el.barArtist.textContent = `${t.albumName} · ${t.artist}`;
  if (t.cover) {
    el.barCover.src = t.cover;
    el.barCover.style.opacity = "1";
    el.barCoverPh.style.opacity = "0";
    // If cover fails to load, fall back to placeholder
    el.barCover.onerror = () => {
      el.barCover.style.opacity = "0";
      el.barCoverPh.style.opacity = "1";
    };
  } else {
    el.barCover.style.opacity = "0";
    el.barCoverPh.style.opacity = "1";
  }
  el.playBtn.innerHTML = el.audio.paused ? "▶" : "⏸";
  const dur = isFinite(el.audio.duration) ? el.audio.duration : parseDur(t.duration);
  el.timeDur.textContent = fmtTime(dur);
  document.title = el.audio.paused
    ? `⏸ ${t.title} — Miner Day Hub`
    : `▶ ${t.title} — Miner Day Hub`;
}

function setProgress(pct) {
  const p = clamp(pct, 0, 100);
  el.progressFill.style.width = `${p}%`;
  el.progressThumb.style.left = `${p}%`;
}

function setVolume(pct) {
  state.volume = clamp(pct / 100, 0, 1);
  el.audio.volume = state.volume;
  const p = clamp(pct, 0, 100);
  el.volFill.style.width  = `${p}%`;
  el.volThumb.style.left  = `${p}%`;
  savePersisted();
}

function railPct(rail, event) {
  const rect = rail.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width * 100, 0, 100);
}

// ─── SHUFFLE / REPEAT BUTTONS ─────────────────────────────────────────────────
function updateShuffleBtn() {
  el.shuffleBtn.classList.toggle("is-active", state.shuffle);
  el.shuffleBtn.title = state.shuffle ? "Shuffle: ON" : "Shuffle: OFF";
}

function updateRepeatBtn() {
  const labels = { none: "↻", all: "↻", one: "↻¹" };
  el.repeatBtn.innerHTML = labels[state.repeat] ?? "↻";
  el.repeatBtn.classList.toggle("is-active", state.repeat !== "none");
  el.repeatBtn.title = { none: "Repeat: Off", all: "Repeat: All", one: "Repeat: One" }[state.repeat];
}

// ─── PROGRESS / VOLUME DRAG ───────────────────────────────────────────────────
el.progressRail.addEventListener("mousedown", e => {
  state.draggingProg = true;
  const pct = railPct(el.progressRail, e);
  setProgress(pct);
  if (isFinite(el.audio.duration)) el.audio.currentTime = el.audio.duration * pct / 100;
});
el.volRail.addEventListener("mousedown", e => { state.draggingVol = true; setVolume(railPct(el.volRail, e)); });
document.addEventListener("mousemove", e => {
  if (state.draggingProg) {
    const pct = railPct(el.progressRail, e);
    setProgress(pct);
    if (isFinite(el.audio.duration)) el.audio.currentTime = el.audio.duration * pct / 100;
  }
  if (state.draggingVol) setVolume(railPct(el.volRail, e));
});
document.addEventListener("mouseup", () => { state.draggingProg = false; state.draggingVol = false; });

// ─── AUDIO EVENTS ─────────────────────────────────────────────────────────────
el.audio.addEventListener("timeupdate", () => {
  if (state.draggingProg) return;
  const dur = isFinite(el.audio.duration) ? el.audio.duration : parseDur(currentTrack()?.duration ?? "");
  const cur = el.audio.currentTime ?? 0;
  el.timeNow.textContent = fmtTime(cur);
  el.timeDur.textContent = fmtTime(dur);
  if (dur > 0) setProgress(cur / dur * 100);
  // Count play at 80% threshold
  maybeCountPlay(false);
});
el.audio.addEventListener("play",  () => { updateBar(); renderQueue(); });
el.audio.addEventListener("pause", updateBar);
el.audio.addEventListener("ended", () => {
  // Always count on natural end regardless of position
  maybeCountPlay(true);
  playNext();
});
el.audio.addEventListener("loadedmetadata", updateBar);
el.audio.addEventListener("error", () => {
  console.error(el.audio.error);
  showToast("Couldn't load audio", true);
});

// ─── TRANSPORT CONTROLS ───────────────────────────────────────────────────────
el.playBtn.addEventListener("click", async () => {
  if (!state.queue.length) {
    const f = visibleAlbums().find(a => !isAlbumLocked(a));
    if (f) playAlbum(f, 0, false);
    return;
  }
  if (state.queueIndex < 0) { playQueueIndex(0); return; }
  if (el.audio.paused) {
    if (!el.audio.src && currentTrack()?.file) el.audio.src = currentTrack().file;
    try { await el.audio.play(); } catch (e) { console.error(e); }
  } else {
    el.audio.pause();
  }
  updateBar();
});

el.prevBtn.addEventListener("click", playPrev);
el.nextBtn.addEventListener("click", playNext);

el.shuffleBtn.addEventListener("click", () => {
  state.shuffle = !state.shuffle;
  if (state.shuffle && state.queue.length) {
    state.shuffleOrder = buildShuffleOrder(state.queue.length, state.queueIndex);
  }
  updateShuffleBtn();
  savePersisted();
});

el.repeatBtn.addEventListener("click", () => {
  const modes = ["none", "all", "one"];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % modes.length];
  updateRepeatBtn();
  savePersisted();
});

el.barLike.addEventListener("click", () => { const t = currentTrack(); if (t?.file) downloadTrack(t); });
el.clearQueueBtn.addEventListener("click", clearQueue);

// Queue panel toggle
el.queueToggle?.addEventListener("click", () => {
  el.queuePanel?.classList.toggle("is-open");
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
let _searchTimer;
el.searchInput.addEventListener("input", () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    const q = el.searchInput.value.trim();
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/search";
  }, 280);
});
el.searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter")  { const q = el.searchInput.value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/search"; }
  if (e.key === "Escape") el.searchInput.blur();
});

// ─── NAV ──────────────────────────────────────────────────────────────────────
el.backBtn.addEventListener("click",  () => history.back());
el.fwdBtn.addEventListener("click",   () => history.forward());
el.reloadBtn.addEventListener("click", loadManifest);
window.addEventListener("hashchange", () => renderPage());

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.code === "Space")                   { e.preventDefault(); el.playBtn.click(); }
  if (e.code === "ArrowRight" && e.altKey)  { e.preventDefault(); playNext(); }
  if (e.code === "ArrowLeft"  && e.altKey)  { e.preventDefault(); playPrev(); }
  if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey) el.shuffleBtn.click();
  if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey) el.repeatBtn.click();
  if (e.code === "ArrowUp"   && e.altKey)  { e.preventDefault(); setVolume(clamp(state.volume * 100 + 10, 0, 100)); }
  if (e.code === "ArrowDown" && e.altKey)  { e.preventDefault(); setVolume(clamp(state.volume * 100 - 10, 0, 100)); }
});

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  document.querySelector(".mdh-toast")?.remove();
  const t = document.createElement("div");
  t.className = "mdh-toast";
  t.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:${isError ? "#200" : "#1a1a1a"};border:1px solid ${isError ? "rgba(232,64,64,0.4)" : "rgba(255,255,255,0.12)"};color:${isError ? "#ff6b6b" : "white"};padding:10px 18px;border-radius:999px;font-size:0.82rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5);pointer-events:none;animation:mdh-up 0.2s ease;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// Inject keyframe + locked row styles
document.head.insertAdjacentHTML("beforeend", `<style>
@keyframes mdh-up{from{transform:translateX(-50%) translateY(8px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
.track-row--locked{opacity:.5;cursor:default!important}
.track-row--locked:hover{background:transparent!important}
</style>`);

// ─── DAILY VIEWS ──────────────────────────────────────────────────────────────
// The GitHub Action writes daily_views.json to the repo once a day.
// We fetch it from GitHub raw, cache it locally as daily_views_client.json
// (via Electron's userData), and merge with local play counts.
//
// daily_views.json shape:
//   { "fetchedAt": "...", "views": { "american-idiot::0": 1234, ... } }

const DAILY_VIEWS_RAW_URL =
  `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/main/daily_views.json`;

const DAILY_VIEWS_CACHE_KEY = "mdh_daily_views_cache";
const DAILY_VIEWS_CACHE_TTL = 6 * 60 * 60 * 1000; // re-fetch after 6 h even if cached

// Load cached daily views from localStorage (offline fallback)
function loadDailyViewsCache() {
  try {
    const raw = localStorage.getItem(DAILY_VIEWS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw); // { fetchedAt, views, cachedAt }
  } catch { return null; }
}

// Persist daily views to localStorage
function saveDailyViewsCache(data) {
  try {
    localStorage.setItem(DAILY_VIEWS_CACHE_KEY, JSON.stringify({
      ...data,
      cachedAt: Date.now(),
    }));
  } catch { /* storage full — ignore */ }
}

// Apply a views map { trackId: count } into state
function applyDailyViews(views) {
  for (const [trackId, count] of Object.entries(views)) {
    const n = Number(count);
    if (Number.isFinite(n) && n >= 0) {
      state.youtubeViewCounts[trackId] = n;
    }
  }
}

async function refreshDailyViews() {
  // Check if cache is fresh enough
  const cached = loadDailyViewsCache();
  if (cached?.views) {
    applyDailyViews(cached.views);
    renderPage();

    // If cache is still fresh, stop here
    const age = Date.now() - (cached.cachedAt ?? 0);
    if (age < DAILY_VIEWS_CACHE_TTL) {
      console.log("[views] Using cached daily_views.json (age:", Math.round(age / 60000), "min)");
      return;
    }
  }

  // Fetch fresh daily_views.json from GitHub raw
  try {
    const res = await fetch(DAILY_VIEWS_RAW_URL + `?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (!data?.views || typeof data.views !== "object") {
      throw new Error("Unexpected daily_views.json shape");
    }

    applyDailyViews(data.views);
    saveDailyViewsCache(data);
    renderPage();
    console.log(`[views] Fetched fresh daily_views.json (${Object.keys(data.views).length} tracks, fetched at ${data.fetchedAt})`);
  } catch (err) {
    // Not a fatal error — just use cached/fallback values
    console.warn("[views] Could not fetch daily_views.json:", err.message);
    if (!cached?.views) {
      console.log("[views] No cache available — play counts will show local plays only.");
    }
  }
}

// ─── LOCAL PLAY TRACKING ──────────────────────────────────────────────────────
// Tracks whether we've already counted a play for the current audio src.
// Reset when src changes, fire at 80% or on 'ended'.
const _playTracking = {
  counted: false,   // have we counted this playthrough yet?
  trackId: null,    // which track are we tracking
};

function resetPlayTracking(trackId) {
  _playTracking.counted = false;
  _playTracking.trackId = trackId;
}

function maybeCountPlay(force = false) {
  if (_playTracking.counted) return;
  if (!_playTracking.trackId) return;

  const dur = el.audio.duration;
  const cur = el.audio.currentTime;

  // Count at 80% of duration OR forced (on 'ended')
  const pct = isFinite(dur) && dur > 0 ? cur / dur : 0;
  if (!force && pct < 0.8) return;

  _playTracking.counted = true;

  const track = trackById(_playTracking.trackId);
  if (!track) return;

  countLocalPlay(track);
}

// ─── MANIFEST ─────────────────────────────────────────────────────────────────
async function loadManifest() {
  try {
    state.manifest = await fetchManifest();
    renderSidebar(); renderQueue(); renderPage(); primeColors();
    // Fire view refresh after manifest loads — non-blocking
    refreshDailyViews();
  } catch (err) {
    console.error("Manifest load failed:", err);
    showToast("Couldn't load releases.json", true);
    state.manifest = { albums: [] };
    renderSidebar(); renderQueue(); renderPage();
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  // Fetch PAT from Electron main process (if running in Electron)
  if (window.electronAPI?.getToken) {
    CONFIG.token = await window.electronAPI.getToken();
  }

  if (window.electronAPI?.getLocalPlayCounts) {
    try {
      state.localPlayCounts = await window.electronAPI.getLocalPlayCounts();
    } catch (err) {
      console.warn("Couldn't load local play counts:", err);
    }
  }

  loadPersisted();
  setVolume(state.volume * 100);
  updateShuffleBtn();
  updateRepeatBtn();
  updateBar();
  renderSidebar();
  renderQueue();
  renderPage();
  loadManifest();
}

init();