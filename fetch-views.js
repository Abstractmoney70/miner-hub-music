#!/usr/bin/env node
"use strict";

/**
 * fetch-views.js
 *
 * Reads releases.json, extracts all YouTube video IDs, calls the YouTube
 * Data API v3 for video statistics (1 unit per video, one call per batch
 * of 50), then writes/overwrites daily_views.json.
 *
 * Usage:
 *   YT_API_KEY=your_key node fetch-views.js
 *
 * Or locally:
 *   node fetch-views.js --key=your_key
 *
 * Output: daily_views.json
 * {
 *   "fetchedAt": "2025-04-11T12:00:00.000Z",
 *   "views": {
 *     "american-idiot::0": 1371471951,
 *     "american-idiot::1": 892341122,
 *     ...
 *   }
 * }
 *
 * Keys match the track IDs used in app.js: `${album.slug}::${trackIndex}`
 */

const fs   = require("fs");
const path = require("path");
const https = require("https");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const RELEASES_PATH     = path.join(__dirname, "releases.json");
const OUTPUT_PATH       = path.join(__dirname, "daily_views.json");
const YT_API_BASE       = "https://www.googleapis.com/youtube/v3/videos";
const BATCH_SIZE        = 50; // YouTube API max per request

// ─── API KEY ──────────────────────────────────────────────────────────────────
// Priority: env var → --key= CLI arg → config.json (local dev only)
function getApiKey() {
  if (process.env.YT_API_KEY) return process.env.YT_API_KEY;

  const keyArg = process.argv.find(a => a.startsWith("--key="));
  if (keyArg) return keyArg.split("=").slice(1).join("=");

  // Local dev fallback — config.json is gitignored
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    if (cfg.youtubeApiKey) return cfg.youtubeApiKey;
  } catch { /* not present */ }

  return null;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("JSON parse error: " + e.message)); }
      });
    }).on("error", reject);
  });
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
  } catch { /* malformed URL */ }

  return null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(
      "ERROR: No YouTube API key found.\n" +
      "Set the YT_API_KEY environment variable, pass --key=..., or add\n" +
      '"youtubeApiKey" to config.json (gitignored).'
    );
    process.exit(1);
  }

  // Load releases.json
  if (!fs.existsSync(RELEASES_PATH)) {
    console.error("ERROR: releases.json not found at", RELEASES_PATH);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(RELEASES_PATH, "utf8"));
  } catch (e) {
    console.error("ERROR: Could not parse releases.json:", e.message);
    process.exit(1);
  }

  const albums = manifest.albums ?? [];

  // Build a map: videoId → [trackId, ...]
  // (multiple tracks could theoretically share a videoId, though unlikely)
  const videoIdToTrackIds = new Map();

  for (const album of albums) {
    for (let i = 0; i < (album.tracks ?? []).length; i++) {
      const track = album.tracks[i];
      const trackId  = `${album.slug}::${i}`;
      const videoId  = parseYouTubeVideoId(track);

      if (!videoId) {
        console.log(`  [skip] ${album.slug} / track ${i} "${track.title}" — no YouTube URL`);
        continue;
      }

      if (!videoIdToTrackIds.has(videoId)) videoIdToTrackIds.set(videoId, []);
      videoIdToTrackIds.get(videoId).push(trackId);
    }
  }

  const uniqueVideoIds = [...videoIdToTrackIds.keys()];
  console.log(`Found ${uniqueVideoIds.length} unique YouTube video IDs across ${albums.length} album(s).`);

  if (!uniqueVideoIds.length) {
    console.warn("No YouTube URLs in releases.json — writing empty daily_views.json.");
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), views: {} }, null, 2));
    return;
  }

  // Fetch in batches of 50
  const viewsByVideoId = {}; // videoId → viewCount (number)
  let totalFetched = 0;
  let totalFailed  = 0;

  for (let i = 0; i < uniqueVideoIds.length; i += BATCH_SIZE) {
    const batch = uniqueVideoIds.slice(i, i + BATCH_SIZE);
    const idsParam = batch.map(encodeURIComponent).join(",");
    const url = `${YT_API_BASE}?part=statistics&id=${idsParam}&key=${encodeURIComponent(apiKey)}`;

    console.log(`Fetching batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} videos)...`);

    try {
      const data = await httpsGet(url);

      if (data.error) {
        console.error("YouTube API error:", JSON.stringify(data.error));
        process.exit(1);
      }

      for (const item of (data.items ?? [])) {
        const views = Number(item.statistics?.viewCount ?? 0);
        if (Number.isFinite(views)) {
          viewsByVideoId[item.id] = views;
          totalFetched++;
        }
      }

      // Log any IDs that came back with no data (private/deleted videos)
      const returnedIds = new Set((data.items ?? []).map(it => it.id));
      for (const id of batch) {
        if (!returnedIds.has(id)) {
          console.warn(`  [warn] Video ID not returned (private/deleted?): ${id}`);
          totalFailed++;
        }
      }
    } catch (err) {
      console.error(`  [error] Batch failed: ${err.message}`);
      totalFailed += batch.length;
    }

    // Polite delay between batches if there are more
    if (i + BATCH_SIZE < uniqueVideoIds.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Build output: trackId → viewCount
  const views = {};
  for (const [videoId, trackIds] of videoIdToTrackIds.entries()) {
    const count = viewsByVideoId[videoId];
    if (Number.isFinite(count)) {
      for (const trackId of trackIds) {
        views[trackId] = count;
      }
    }
  }

  const output = {
    fetchedAt: new Date().toISOString(),
    views,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log(`\nDone.`);
  console.log(`  Fetched : ${totalFetched} videos`);
  console.log(`  Failed  : ${totalFailed} videos`);
  console.log(`  Output  : ${OUTPUT_PATH}`);
  console.log(`  Tracks  : ${Object.keys(views).length} track entries written`);
}

main().catch(err => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
