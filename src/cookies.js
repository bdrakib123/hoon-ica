/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

function parseCookieString(raw) {
  const jar = {};
  raw
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return;
      jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    });
  return jar;
}

function normalizeCookie(input) {
  const trimmed = input.trim();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const jar = {};
    for (const c of arr) {
      const key = c.key || c.name;
      if (key && c.value) jar[key] = c.value;
    }
    return jar;
  }

  if (trimmed.includes("=")) return parseCookieString(trimmed);

  return { sessionid: trimmed.replace("sessionid=", "") };
}

function toHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

module.exports = { normalizeCookie, toHeader };
