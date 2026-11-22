/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function generateDeviceId() {
  return `android-${crypto.createHash("md5").update(crypto.randomUUID()).digest("hex").slice(0, 16)}`;
}

function loadOrCreate(filePath, igDid) {
  if (fs.existsSync(filePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (saved.deviceId && saved.uuid) return saved;
    } catch (_) {}
  }

  const identity = {
    deviceId: igDid ? `android-${igDid.replace(/-/g, "").toLowerCase().slice(0, 16)}` : generateDeviceId(),
    uuid: igDid ? igDid.toLowerCase() : crypto.randomUUID()
  };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(identity, null, 2));
  } catch (_) {}

  return identity;
}

module.exports = { loadOrCreate, generateDeviceId };
