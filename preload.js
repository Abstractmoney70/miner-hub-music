"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Auth
  getToken:   () => ipcRenderer.invoke("get-token"),
  getVersion: () => ipcRenderer.invoke("get-version"),

  // Play counts
  getLocalPlayCounts:  ()         => ipcRenderer.invoke("get-local-play-counts"),
  incrementLocalPlay:  (trackId)  => ipcRenderer.invoke("increment-local-play", trackId),

  // Downloads & external links
  downloadTrack: (payload) => ipcRenderer.invoke("download-track", payload),
  openExternal:  (url)     => ipcRenderer.invoke("open-external", url),

  // Custom title bar window controls
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose:    () => ipcRenderer.invoke("window-close"),
});