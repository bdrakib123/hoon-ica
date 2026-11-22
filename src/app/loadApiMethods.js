/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Attaches every src/api/<group>/<method>.js factory onto the client, keyed by
// the file name. A file exports `function (client) { return function ... }`, so
// adding a new method is just adding a file — no central list to edit.

const fs = require("fs");
const path = require("path");

const API_ROOT = path.join(__dirname, "..", "api");

function loadApiMethods(client) {
  const loaded = [];
  for (const group of fs.readdirSync(API_ROOT, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(API_ROOT, group.name);
    for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      const key = path.basename(entry.name, ".js");
      if (typeof client[key] === "function") continue;
      const mod = require(path.join(groupDir, entry.name));
      const factory = typeof mod === "function" ? mod : mod && mod.default;
      if (typeof factory !== "function") continue;
      client[key] = factory(client);
      loaded.push(key);
    }
  }
  return loaded;
}

module.exports = loadApiMethods;
