"use strict";

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  manifest: null,
  queue: [],
  queueIndex: -1,
  shuffle: false,
  repeat: "none", // "none" | "all" | "one"
  volume: 0.8,
  draggingProgress: false,
  draggingVolume: false,
  colors: new Map(),
};

// ─── ELEMENTS ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  page:           $("page"),
  sidebarLibrary: $("sidebarLibrary"),
  manifestPath:   $("manifestPath"),
  reloadBtn:      $("reloadBtn"),
  backBtn:        $("backBtn"),
  fwdBtn:         $("fwdBtn"),
  searchInput:    $("searchInput"),
  // queue
  queuePanel:     $("queuePanel"),
  queueNow:       $("queueNow"),
  queueList:      $("queueList"),
  clearQueueBtn:  $("clearQueueBtn"),
  queueToggleBtn: $("queueToggleBtn"),
  // bar
  barCover:       $("barCover"),
  barCoverPh:     $("barCoverPlaceholder"),
  barTitle:       $("barTitle"),
  barArtist:      $("barArtist"),
  barLike:        $("barLike"),
  timeNow:        $("timeNow"),
  timeDur:        $("timeDur"),
  progressRail:   $("progressRail"),
  progressFill:   $("progressFill"),
  progressThumb:  $("progressThumb"),
  playBtn:        $("playBtn"),
  prevBtn:        $("prevBtn"),
  nextBtn:        $("nextBtn"),
  shuffleBtn:     $("shuffleBtn"),
  repeatBtn:      $("repeatBtn"),
  volRail:        $("volRail"),
  volFill:        $("volFill"),
  volThumb:       $("volThumb"),
  audio:          $("audio"),
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

function fmtPlays(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}

function parseDuration(str) {
  if (!str || !str.includes(":")) return 0;
  const [m, s] = str.split(":").map(Number);
  return m * 60 + (s || 0);
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// ─── DATA ─────────────────────────────────────────────────────────────────────
function albums() { return state.manifest?.albums ?? []; }

function albumBySlug(slug) { return albums().find(a => a.slug === slug) ?? null; }

function normTrack(t, album, i) {
  return {
    id: `${album.slug}::${i}`,
    title: t.title,
    file: t.file ?? "",
    duration: t.duration ?? "",
    artist: t.artist ?? album.artist ?? "Green Day",
    plays: t.plays ?? null,
    explicit: Boolean(t.explicit),
    early: Boolean(t.early),
    albumName: album.name,
    albumYear: album.year,
    albumSlug: album.slug,
    cover: album.cover ?? "",
    trackIndex: i,
  };
}

function albumTracks(album) {
  return (album.tracks ?? []).map((t, i) => normTrack(t, album, i));
}

function allTracks() {
  return albums().flatMap(albumTracks);
}

function trackById(id) {
  return allTracks().find(t => t.id === id) ?? null;
}

function currentTrack() {
  return state.queue[state.queueIndex] ?? null;
}

// ─── ROUTING ──────────────────────────────────────────────────────────────────
function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "albums") return { name: "albums" };
  if (parts[0] === "search") return { name: "search", q: decodeURIComponent(parts.slice(1).join("/") || "") };
  if (parts[0] === "album" && parts[1]) return { name: "album", slug: decodeURIComponent(parts[1]) };
  return { name: "home" };
}

function navigate(hash) {
  location.hash = hash;
}

function syncNav() {
  const r = route();
  document.querySelectorAll(".nav-item").forEach(a => {
    const dr = a.dataset.route;
    const active =
      (dr === "home" && r.name === "home") ||
      (dr === "albums" && (r.name === "albums" || r.name === "album")) ||
      (dr === "search" && r.name === "search");
    a.classList.toggle("is-active", active);
  });
  document.querySelectorAll(".lib-album").forEach(a => {
    a.classList.toggle("is-active", a.href?.endsWith(location.hash));
  });
}

// ─── ALBUM COLOR EXTRACTION ───────────────────────────────────────────────────
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
        // Darken significantly for background use
        const scale = 1.1;
        state.colors.set(album.slug, `rgba(${Math.min(255,Math.round(r/n*scale))},${Math.min(255,Math.round(g/n*0.5))},${Math.min(255,Math.round(b/n*0.5))},0.95)`);
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

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = albums();
  if (!list.length) {
    el.sidebarLibrary.innerHTML = `<div class="sidebar__empty">No albums loaded.</div>`;
    return;
  }
  el.sidebarLibrary.innerHTML = list.map(a => `
    <a class="lib-album" href="#/album/${encodeURIComponent(a.slug)}">
      ${a.cover
        ? `<img class="lib-album__art" src="${esc(a.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : `<div class="lib-album__art" style="background:var(--surface-3);display:grid;place-items:center;font-size:1.2rem">⛏</div>`
      }
      <div>
        <div class="lib-album__name">${esc(a.name)}</div>
        <div class="lib-album__meta">Album · ${esc(a.year)}</div>
      </div>
    </a>
  `).join("");
}

// ─── PAGES ────────────────────────────────────────────────────────────────────

function renderHome() {
  const list = albums();
  const featured = list[0];
  const color = featured ? (state.colors.get(featured.slug) ?? "rgba(40,40,40,0.9)") : "rgba(40,40,40,0.9)";

  el.page.innerHTML = `
    ${featured ? `
    <section class="hero" style="--hero-color: ${esc(color)}">
      <div class="hero__bg"></div>
      <div class="hero__noise"></div>
      <div class="hero__content">
        ${featured.cover
          ? `<img class="hero__cover" src="${esc(featured.cover)}" alt="${esc(featured.name)}" onerror="this.outerHTML='<div class=hero__cover-placeholder>⛏</div>'">`
          : `<div class="hero__cover-placeholder">⛏</div>`
        }
        <div>
          <div class="hero__label">Featured Album</div>
          <h2 class="hero__title">${esc(featured.name)}</h2>
          <p class="hero__meta"><strong>${esc(featured.artist ?? "Green Day")}</strong> · ${esc(featured.year)} · ${featured.tracks?.length ?? 0} tracks · Noteblock cover</p>
          <div class="hero__actions">
            <button class="btn-green" data-action="play-album" data-slug="${esc(featured.slug)}">▶ Play</button>
            <button class="btn-outline" data-action="queue-album" data-slug="${esc(featured.slug)}">+ Add to queue</button>
            <a class="btn-outline" href="#/album/${encodeURIComponent(featured.slug)}">View album</a>
          </div>
        </div>
      </div>
    </section>
    ` : `<div class="page-empty">No albums loaded. Check releases.json</div>`}

    <div class="strip">
      <div class="strip__header">
        <div class="strip__title">All Albums</div>
        <a class="strip__link" href="#/albums">See all</a>
      </div>
      <div class="album-grid">
        ${list.map(renderAlbumCard).join("")}
      </div>
    </div>
  `;

  bindPageEvents();
}

function renderAlbums() {
  const list = albums();
  el.page.innerHTML = `
    <div class="strip" style="padding-top:28px">
      <div class="strip__header">
        <div class="strip__title">Albums</div>
      </div>
      <div class="album-grid">
        ${list.map(renderAlbumCard).join("")}
      </div>
    </div>
  `;
  bindPageEvents();
}

function renderAlbumCard(a) {
  return `
    <a class="album-card" href="#/album/${encodeURIComponent(a.slug)}">
      <div class="album-card__art">
        ${a.cover
          ? `<img class="album-card__img" src="${esc(a.cover)}" alt="${esc(a.name)}" loading="lazy" onerror="this.outerHTML='<div class=album-card__img-placeholder>⛏</div>'">`
          : `<div class="album-card__img-placeholder">⛏</div>`
        }
        <button class="album-card__play" data-action="play-album" data-slug="${esc(a.slug)}" aria-label="Play ${esc(a.name)}">▶</button>
      </div>
      <div class="album-card__name">${esc(a.name)}</div>
      <div class="album-card__year">${esc(a.year)}</div>
    </a>
  `;
}

function renderAlbumPage(slug) {
  const album = albumBySlug(slug);
  if (!album) { el.page.innerHTML = `<div class="page-empty">Album not found.</div>`; return; }

  const tracks = albumTracks(album);
  const color = state.colors.get(slug) ?? "rgba(30,30,30,0.95)";
  const others = albums().filter(a => a.slug !== slug);

  el.page.innerHTML = `
    <div class="album-hero">
      <div class="album-hero__bg">
        <div class="album-hero__bg-inner" style="--album-color: ${esc(color)}"></div>
      </div>
      <div class="album-hero__content">
        ${album.cover
          ? `<img class="album-hero__cover" src="${esc(album.cover)}" alt="${esc(album.name)}" onerror="this.outerHTML='<div class=album-hero__cover-placeholder>⛏</div>'">`
          : `<div class="album-hero__cover-placeholder">⛏</div>`
        }
        <div>
          <div class="album-hero__type">Album · Noteblock Cover</div>
          <h2 class="album-hero__title">${esc(album.name)}</h2>
          <p class="album-hero__meta">
            <strong>${esc(album.artist ?? "Green Day")}</strong> · ${esc(album.year)} · ${tracks.length} songs
          </p>
        </div>
      </div>
    </div>

    <div class="album-toolbar">
      <button class="play-btn-big" data-action="play-album" data-slug="${esc(album.slug)}" aria-label="Play album">▶</button>
      <button class="btn-outline" data-action="queue-album" data-slug="${esc(album.slug)}">+ Add to queue</button>
      <button class="btn-outline" data-action="shuffle-album" data-slug="${esc(album.slug)}">⇄ Shuffle</button>
    </div>

    <div class="track-table">
      <div class="track-table__head">
        <div>#</div>
        <div>Title</div>
        <div style="text-align:right">Plays</div>
        <div style="text-align:right">⏱</div>
        <div></div>
      </div>
      <div id="trackList">
        ${tracks.map((t, i) => renderTrackRow(t, i)).join("")}
      </div>
    </div>

    ${others.length ? `
    <div class="more-strip">
      <div class="strip__header">
        <div class="strip__title">More by Green Day</div>
        <a class="strip__link" href="#/albums">See all</a>
      </div>
      <div class="album-grid">
        ${others.slice(0, 6).map(renderAlbumCard).join("")}
      </div>
    </div>
    ` : ""}
  `;

  bindPageEvents();
}

function renderTrackRow(track, i) {
  const playing = currentTrack()?.id === track.id;
  return `
    <div class="track-row ${playing ? "is-playing" : ""}" data-track-id="${esc(track.id)}">
      <div class="track-row__num">${playing ? "▶" : i + 1}</div>
      <div>
        <div class="track-row__title">${esc(track.title)}</div>
        <div class="track-row__artist">
          ${track.explicit ? `<span class="badge-e">E</span>` : ""}
          ${esc(track.artist)}
          ${track.early ? `<span style="color:var(--green);font-size:0.7rem;font-weight:700">EARLY</span>` : ""}
        </div>
      </div>
      <div class="track-row__plays">${fmtPlays(track.plays)}</div>
      <div class="track-row__dur">${esc(track.duration || "—")}</div>
      <div class="track-row__actions">
        ${track.file
          ? `<button class="track-action track-action--play" data-action="play-track" data-track-id="${esc(track.id)}">▶ Play</button>
             <button class="track-action" data-action="queue-track" data-track-id="${esc(track.id)}">+ Queue</button>`
          : `<span style="font-size:0.72rem;color:var(--text-3)">Coming soon</span>`
        }
        ${track.file
          ? `<button class="track-action" data-action="download-track" data-track-id="${esc(track.id)}" title="Download">⬇</button>`
          : ""
        }
      </div>
    </div>
  `;
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
        <div class="strip__header" style="margin-bottom:12px">
          <div class="strip__title">Browse Albums</div>
        </div>
        <div class="album-grid">
          ${albums().map(renderAlbumCard).join("")}
        </div>
      </div>
    `;
    bindPageEvents();
    return;
  }

  const matchedAlbums = albums().filter(a =>
    `${a.name} ${a.year} ${a.artist}`.toLowerCase().includes(query)
  );

  const matchedTracks = allTracks().filter(t =>
    `${t.title} ${t.artist} ${t.albumName} ${t.albumYear}`.toLowerCase().includes(query)
  );

  el.page.innerHTML = `
    <div class="search-page">
      <div class="search-page__hero">
        <div class="search-page__title">Results for "${esc(q)}"</div>
        <div class="search-page__sub">${matchedAlbums.length + matchedTracks.length} results found</div>
      </div>

      ${matchedAlbums.length ? `
        <div class="search-section">
          <div class="search-results__label">Albums</div>
          <div class="album-grid">
            ${matchedAlbums.map(renderAlbumCard).join("")}
          </div>
        </div>
      ` : ""}

      ${matchedTracks.length ? `
        <div class="search-section">
          <div class="search-results__label">Tracks</div>
          <div id="trackList">
            ${matchedTracks.map((t, i) => renderTrackRow(t, i)).join("")}
          </div>
        </div>
      ` : ""}

      ${!matchedAlbums.length && !matchedTracks.length
        ? `<div class="page-empty" style="height:200px">No results for "${esc(q)}"</div>`
        : ""
      }
    </div>
  `;

  bindPageEvents();
}

// ─── PAGE RENDER ROUTER ───────────────────────────────────────────────────────
function renderPage() {
  const r = route();
  syncNav();

  if (r.name === "albums") { renderAlbums(); return; }
  if (r.name === "album")  { renderAlbumPage(r.slug); return; }
  if (r.name === "search") { renderSearch(r.q); return; }
  renderHome();
}

// ─── EVENT BINDING ────────────────────────────────────────────────────────────
function bindPageEvents() {
  // Album card play buttons (stop link nav)
  el.page.querySelectorAll("[data-action='play-album']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const a = albumBySlug(btn.dataset.slug);
      if (a) playAlbum(a, 0);
    });
  });

  el.page.querySelectorAll("[data-action='queue-album']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const a = albumBySlug(btn.dataset.slug);
      if (a) { queueAlbum(a); renderQueue(); }
    });
  });

  el.page.querySelectorAll("[data-action='shuffle-album']").forEach(btn => {
    btn.addEventListener("click", () => {
      const a = albumBySlug(btn.dataset.slug);
      if (a) {
        const shuffled = [...albumTracks(a)].sort(() => Math.random() - 0.5);
        replaceQueue(shuffled, 0);
      }
    });
  });

  el.page.querySelectorAll("[data-action='play-track']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const t = trackById(btn.dataset.trackId);
      if (t) playTrackNow(t);
    });
  });

  el.page.querySelectorAll("[data-action='queue-track']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const t = trackById(btn.dataset.trackId);
      if (t) { state.queue.push(t); renderQueue(); }
    });
  });

  el.page.querySelectorAll("[data-action='download-track']").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const t = trackById(btn.dataset.trackId);
      if (t?.file) downloadTrack(t);
    });
  });

  // Double-click track row to play
  el.page.querySelectorAll(".track-row").forEach(row => {
    row.addEventListener("dblclick", () => {
      const t = trackById(row.dataset.trackId);
      if (t?.file) playTrackNow(t);
    });
  });
}

// ─── QUEUE ────────────────────────────────────────────────────────────────────
function renderQueue() {
  const ct = currentTrack();

  // Now playing section
  el.queueNow.innerHTML = ct ? `
    <div class="queue__now-inner">
      ${ct.cover
        ? `<img class="queue__now-art" src="${esc(ct.cover)}" alt="">`
        : `<div class="queue__now-art" style="background:var(--surface-3);display:grid;place-items:center">⛏</div>`
      }
      <div>
        <div class="queue__now-title">${esc(ct.title)}</div>
        <div class="queue__now-album">${esc(ct.albumName)}</div>
      </div>
    </div>
  ` : `<div style="color:var(--text-3);font-size:0.8rem">Nothing playing</div>`;

  // Queue list
  if (!state.queue.length) {
    el.queueList.innerHTML = `<div class="queue__empty">Queue is empty.<br>Play an album or add tracks.</div>`;
    return;
  }

  el.queueList.innerHTML = state.queue.map((t, i) => `
    <div class="queue-item ${i === state.queueIndex ? "is-active" : ""}" data-qi="${i}">
      <div class="queue-item__num">${i === state.queueIndex ? "▶" : i + 1}</div>
      <div class="queue-item__info">
        <div class="queue-item__title">${esc(t.title)}</div>
        <div class="queue-item__album">${esc(t.albumName)}</div>
      </div>
      <div class="queue-item__actions">
        <button class="queue-item-btn" data-qi-action="play" data-qi="${i}" title="Play">▶</button>
        <button class="queue-item-btn" data-qi-action="up" data-qi="${i}" title="Move up">↑</button>
        <button class="queue-item-btn" data-qi-action="down" data-qi="${i}" title="Move down">↓</button>
        <button class="queue-item-btn" data-qi-action="remove" data-qi="${i}" title="Remove">✕</button>
      </div>
    </div>
  `).join("");

  el.queueList.querySelectorAll("[data-qi-action]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const i = Number(btn.dataset.qi);
      const action = btn.dataset.qiAction;
      if (action === "play") { playQueueIndex(i); renderPage(); }
      else if (action === "remove") removeFromQueue(i);
      else moveInQueue(i, action === "up" ? i - 1 : i + 1);
      renderQueue();
    });
  });

  // Scroll active item into view
  const active = el.queueList.querySelector(".is-active");
  active?.scrollIntoView({ block: "nearest" });
}

function replaceQueue(tracks, startIndex) {
  state.queue = [...tracks];
  state.queueIndex = -1;
  playQueueIndex(startIndex);
}

function playAlbum(album, startIndex) {
  replaceQueue(albumTracks(album), startIndex);
}

function queueAlbum(album) {
  state.queue.push(...albumTracks(album));
}

function playTrackNow(track) {
  // Insert right after current, then play
  const insertAt = state.queueIndex >= 0 ? state.queueIndex + 1 : 0;
  state.queue.splice(insertAt, 0, track);
  playQueueIndex(insertAt);
  renderPage();
}

function playQueueIndex(i) {
  const t = state.queue[i];
  if (!t) return;
  state.queueIndex = i;
  if (t.file) {
    el.audio.src = t.file;
    el.audio.play().catch(console.error);
  } else {
    // No file yet — update UI but don't try to play
    updateBar();
    renderQueue();
    renderPage();
    return;
  }
  updateBar();
  renderQueue();
}

function removeFromQueue(i) {
  const wasCurrent = i === state.queueIndex;
  state.queue.splice(i, 1);
  if (!state.queue.length) { clearQueue(); return; }
  if (wasCurrent) { playQueueIndex(Math.min(i, state.queue.length - 1)); return; }
  if (i < state.queueIndex) state.queueIndex--;
}

function moveInQueue(from, to) {
  if (to < 0 || to >= state.queue.length) return;
  const [item] = state.queue.splice(from, 1);
  state.queue.splice(to, 0, item);
  if (state.queueIndex === from) state.queueIndex = to;
  else if (from < state.queueIndex && to >= state.queueIndex) state.queueIndex--;
  else if (from > state.queueIndex && to <= state.queueIndex) state.queueIndex++;
}

function clearQueue() {
  state.queue = [];
  state.queueIndex = -1;
  el.audio.pause();
  el.audio.removeAttribute("src");
  updateBar();
  renderQueue();
  renderPage();
}

function playNext() {
  if (!state.queue.length) return;
  if (state.repeat === "one") { el.audio.currentTime = 0; el.audio.play(); return; }
  let next = state.queueIndex + 1;
  if (next >= state.queue.length) {
    if (state.repeat === "all") next = 0;
    else { el.audio.pause(); updateBar(); return; }
  }
  playQueueIndex(next);
  renderPage();
}

function playPrev() {
  if (el.audio.currentTime > 3) { el.audio.currentTime = 0; return; }
  const prev = state.queueIndex - 1;
  if (prev >= 0) { playQueueIndex(prev); renderPage(); }
}

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
function downloadTrack(track) {
  const a = document.createElement("a");
  a.href = track.file;
  a.download = `${track.title}.mp3`;
  a.click();
}

// ─── NOW PLAYING BAR ─────────────────────────────────────────────────────────
function updateBar() {
  const t = currentTrack();
  if (!t) {
    el.barTitle.textContent = "Nothing playing";
    el.barArtist.textContent = "—";
    el.barCover.hidden = true;
    el.barCoverPh.hidden = false;
    el.playBtn.innerHTML = "▶";
    el.timeNow.textContent = "0:00";
    el.timeDur.textContent = "0:00";
    setProgress(0);
    document.title = "Miner Day Hub";
    return;
  }

  el.barTitle.textContent = t.title;
  el.barArtist.textContent = `${t.albumName} · ${t.artist}`;

  if (t.cover) {
    el.barCover.src = t.cover;
    el.barCover.hidden = false;
    el.barCoverPh.hidden = true;
  } else {
    el.barCover.hidden = true;
    el.barCoverPh.hidden = false;
  }

  el.playBtn.innerHTML = el.audio.paused ? "▶" : "⏸";

  const dur = isFinite(el.audio.duration) ? el.audio.duration : parseDuration(t.duration);
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
  const p = clamp(pct, 0, 100);
  state.volume = p / 100;
  el.audio.volume = state.volume;
  el.volFill.style.width = `${p}%`;
  el.volThumb.style.left = `${p}%`;
}

// ─── PROGRESS RAIL INTERACTION ────────────────────────────────────────────────
function railPct(rail, event) {
  const rect = rail.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width * 100, 0, 100);
}

el.progressRail.addEventListener("mousedown", e => {
  state.draggingProgress = true;
  const pct = railPct(el.progressRail, e);
  setProgress(pct);
  if (isFinite(el.audio.duration)) {
    el.audio.currentTime = el.audio.duration * pct / 100;
  }
});

el.volRail.addEventListener("mousedown", e => {
  state.draggingVolume = true;
  setVolume(railPct(el.volRail, e));
});

document.addEventListener("mousemove", e => {
  if (state.draggingProgress) {
    const pct = railPct(el.progressRail, e);
    setProgress(pct);
    if (isFinite(el.audio.duration)) {
      el.audio.currentTime = el.audio.duration * pct / 100;
    }
  }
  if (state.draggingVolume) {
    setVolume(railPct(el.volRail, e));
  }
});

document.addEventListener("mouseup", () => {
  state.draggingProgress = false;
  state.draggingVolume = false;
});

// ─── AUDIO EVENTS ─────────────────────────────────────────────────────────────
el.audio.addEventListener("timeupdate", () => {
  if (state.draggingProgress) return;
  const dur = isFinite(el.audio.duration)
    ? el.audio.duration
    : parseDuration(currentTrack()?.duration ?? "");
  const cur = el.audio.currentTime ?? 0;
  el.timeNow.textContent = fmtTime(cur);
  el.timeDur.textContent = fmtTime(dur);
  if (dur > 0) setProgress(cur / dur * 100);
});

el.audio.addEventListener("play",  () => { updateBar(); renderQueue(); });
el.audio.addEventListener("pause", () => { updateBar(); });
el.audio.addEventListener("ended", playNext);
el.audio.addEventListener("loadedmetadata", updateBar);
el.audio.addEventListener("error", () => {
  console.error("Audio error:", el.audio.error);
});

// ─── TRANSPORT BUTTONS ────────────────────────────────────────────────────────
el.playBtn.addEventListener("click", async () => {
  if (!state.queue.length) {
    const first = albums()[0];
    if (first) playAlbum(first, 0);
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
  el.shuffleBtn.classList.toggle("is-active", state.shuffle);
});

el.repeatBtn.addEventListener("click", () => {
  const modes = ["none", "all", "one"];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % modes.length];
  el.repeatBtn.classList.toggle("is-active", state.repeat !== "none");
  el.repeatBtn.innerHTML = state.repeat === "one" ? "↻¹" : "↻";
  el.repeatBtn.title = { none: "Repeat off", all: "Repeat all", one: "Repeat one" }[state.repeat];
});

el.barLike.addEventListener("click", () => {
  const t = currentTrack();
  if (t?.file) downloadTrack(t);
});

el.clearQueueBtn.addEventListener("click", clearQueue);

el.queueToggleBtn.addEventListener("click", () => {
  el.queuePanel.style.display = el.queuePanel.style.display === "none" ? "" : "none";
});

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.code === "Space") { e.preventDefault(); el.playBtn.click(); }
  if (e.code === "ArrowRight" && e.altKey) { e.preventDefault(); playNext(); }
  if (e.code === "ArrowLeft"  && e.altKey) { e.preventDefault(); playPrev(); }
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
el.searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const q = el.searchInput.value.trim();
    navigate(q ? `#/search/${encodeURIComponent(q)}` : "#/search");
  }
});

el.searchInput.addEventListener("input", () => {
  // Live search after short debounce
  clearTimeout(el._searchTimer);
  el._searchTimer = setTimeout(() => {
    const q = el.searchInput.value.trim();
    if (route().name === "search" || q) {
      navigate(q ? `#/search/${encodeURIComponent(q)}` : "#/search");
    }
  }, 300);
});

// ─── NAV ──────────────────────────────────────────────────────────────────────
el.backBtn.addEventListener("click", () => history.back());
el.fwdBtn.addEventListener("click", () => history.forward());
el.reloadBtn.addEventListener("click", loadManifest);

window.addEventListener("hashchange", () => {
  renderPage();
  el.backBtn.disabled = history.length <= 1;
});

// ─── MANIFEST LOAD ────────────────────────────────────────────────────────────
async function loadManifest() {
  try {
    const res = await fetch(`./releases.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.manifest = await res.json();
    renderSidebar();
    renderQueue();
    renderPage();
    primeColors();
  } catch (err) {
    console.error("Manifest load failed:", err);
    state.manifest = { albums: [] };
    renderSidebar();
    renderQueue();
    renderPage();
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
setVolume(80);
updateBar();
renderSidebar();
renderQueue();
renderPage();
loadManifest();
