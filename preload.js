"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose a safe, minimal API to the renderer.
// The renderer never touches Node or Electron directly.
contextBridge.exposeInMainWorld("electronAPI", {
  // Ask main process for the GitHub PAT (never stored in renderer)
  getToken: () => ipcRenderer.invoke("get-token"),

  // Ask main process for app version
  getVersion: () => ipcRenderer.invoke("get-version"),

  // Read and update the per-user local play overlay.
  getLocalPlayCounts: () => ipcRenderer.invoke("get-local-play-counts"),
  incrementLocalPlay: (trackId) => ipcRenderer.invoke("increment-local-play", trackId),

  // Save a remote file into the OS Downloads folder.
  downloadTrack: (payload) => ipcRenderer.invoke("download-track", payload),

  // Open a URL in the system browser (for external links)
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
