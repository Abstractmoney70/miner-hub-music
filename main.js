"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs   = require("fs");

function getLocalPlaysPath() {
  return path.join(app.getPath("userData"), "total_local_plays.json");
}

function readLocalPlays() {
  const filePath = getLocalPlaysPath();
  try {
    if (!fs.existsSync(filePath)) {
      return { tracks: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && parsed.tracks && typeof parsed.tracks === "object"
      ? parsed
      : { tracks: {} };
  } catch (err) {
    console.warn("Could not read total_local_plays.json:", err.message);
    return { tracks: {} };
  }
}

function writeLocalPlays(data) {
  const filePath = getLocalPlaysPath();
  const nextData = {
    tracks: data?.tracks && typeof data.tracks === "object" ? data.tracks : {},
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(nextData, null, 2), "utf8");
  return nextData;
}

function sanitizeFilename(name) {
  return String(name || "download")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "download";
}

// ─── LOAD CONFIG ──────────────────────────────────────────────────────────────
// PAT lives in config.json which is gitignored — never hardcode it in app.js.
// If config.json doesn't exist we fall back to "" so the app still opens.
function loadConfig() {
  const cfgPath = path.join(__dirname, "config.json");
  try {
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    }
  } catch (err) {
    console.warn("Could not load config.json:", err.message);
  }
  return {};
}

const config = loadConfig();

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────
ipcMain.handle("get-token", () => config.githubToken ?? "");
ipcMain.handle("get-version", () => app.getVersion());
ipcMain.handle("get-local-play-counts", () => readLocalPlays().tracks);
ipcMain.handle("increment-local-play", (_event, trackId) => {
  if (typeof trackId !== "string" || !trackId.trim()) {
    throw new Error("A valid track id is required.");
  }
  const data = readLocalPlays();
  const key = trackId.trim();
  data.tracks[key] = (Number(data.tracks[key]) || 0) + 1;
  const saved = writeLocalPlays(data);
  return saved.tracks[key];
});
ipcMain.handle("open-external", (_event, url) => {
  // Only allow https URLs so the renderer can't abuse this
  if (typeof url === "string" && url.startsWith("https://")) {
    shell.openExternal(url);
  }
});
ipcMain.handle("download-track", (event, payload) => {
  const url = typeof payload?.url === "string" ? payload.url : "";
  const filename = sanitizeFilename(payload?.filename);
  if (!url.startsWith("https://")) {
    throw new Error("Only https downloads are allowed.");
  }

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    throw new Error("No active window available for download.");
  }

  const savePath = path.join(app.getPath("downloads"), filename);
  const session = win.webContents.session;
  const handler = (_downloadEvent, item, webContents) => {
    if (webContents !== win.webContents || item.getURL() !== url) return;
    item.setSavePath(savePath);
    session.removeListener("will-download", handler);
  };

  session.on("will-download", handler);
  win.webContents.downloadURL(url);
  return { savePath };
});

// ─── WINDOW ───────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  960,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      nodeIntegration:  false,   // never true
      contextIsolation: true,    // keep the sandbox up
      sandbox: true,             // renderer runs in sandbox
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile("index.html");

  // Prevent renderer from navigating away (security best practice)
  win.webContents.on("will-navigate", (e, url) => {
    const appUrl = "file://" + path.join(__dirname, "index.html");
    if (url !== appUrl) e.preventDefault();
  });

  // Open any target="_blank" links in the system browser instead
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
