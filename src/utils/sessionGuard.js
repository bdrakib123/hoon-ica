/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

"use strict";

const fs = require("fs");
const { dataPath } = require("./dataDir");

const SAVE_INTERVAL_MS = 5 * 60 * 1000;
const MIN_COOKIES = 3;
const KEEP_FROM_SEED = new Set(["sessionid", "ds_user_id"]);

function secureFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
  } catch (_) {}
}

function readCookieFile(filePath) {
  try {
    secureFile(filePath);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function loadSaved(filePath, seed) {
  const target = filePath || dataPath("appstate.json");
  const primary = readCookieFile(target);
  // A syntactically valid but incomplete primary file is still corrupt for
  // recovery purposes; try the last known-good backup before giving up.
  const entries = primary && primary.length >= MIN_COOKIES
    ? primary
    : readCookieFile(`${target}.bak`);
  if (!entries || entries.length < MIN_COOKIES) return null;
  const map = {};
  for (const c of entries) {
    const key = c && (c.key || c.name);
    if (key && c.value) map[key] = c.value;
  }
  if (!seed || !seed.sessionid || map.sessionid !== seed.sessionid) return null;
  for (const key of KEEP_FROM_SEED) delete map[key];
  return map;
}

function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, filePath);
  secureFile(filePath);
}

function install(client, appStatePath) {
  if (!client || typeof client.getAppState !== "function") return null;
  const target = appStatePath || dataPath("appstate.json");

  function getState() {
    try {
      return client.getAppState();
    } catch (_) {
      return null;
    }
  }

  function save(filePath = target) {
    const state = getState();
    if (!Array.isArray(state) || state.length < MIN_COOKIES) return false;
    try {
      secureFile(filePath);
      secureFile(`${filePath}.bak`);
      if (fs.existsSync(filePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (Array.isArray(existing) && state.length < existing.length * 0.8) return false;
          writeAtomic(`${filePath}.bak`, JSON.stringify(existing, null, 2));
        } catch (_) {}
      }
      writeAtomic(filePath, JSON.stringify(state, null, 2));
      return true;
    } catch (_) {
      return false;
    }
  }

  const timer = setInterval(() => save(), SAVE_INTERVAL_MS);
  if (timer.unref) timer.unref();

  const onExit = () => save();
  process.once("exit", onExit);

  client.saveSession = (p) => save(p || target);
  client.stopSessionGuard = () => {
    clearInterval(timer);
    process.removeListener("exit", onExit);
  };

  save();

  return { save: client.saveSession, stop: client.stopSessionGuard, path: target };
}

module.exports = { install, loadSaved, SAVE_INTERVAL_MS, MIN_COOKIES };
