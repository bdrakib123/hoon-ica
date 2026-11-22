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

function normalizeCookieObject(input) {
  const jar = {};
  if (Array.isArray(input)) {
    for (const cookie of input) {
      if (!cookie || typeof cookie !== "object") continue;
      const key = cookie.key || cookie.name;
      if (key && cookie.value !== undefined && cookie.value !== null) {
        jar[String(key)] = String(cookie.value);
      }
    }
    return jar;
  }

  if (!input || typeof input !== "object") {
    throw new TypeError("Cookie must be a string, object, or cookie array");
  }

  // Also accept a single browser cookie record: { name, value }.
  if ((input.name || input.key) && input.value !== undefined) {
    jar[String(input.key || input.name)] = String(input.value);
    return jar;
  }

  // Documented map form: { sessionid: "...", csrftoken: "..." }.
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) jar[key] = String(value);
  }
  return jar;
}

function normalizeCookie(input) {
  if (Array.isArray(input) || (input && typeof input === "object")) {
    return normalizeCookieObject(input);
  }
  if (typeof input !== "string") {
    throw new TypeError("Cookie must be a string, object, or cookie array");
  }

  const trimmed = input.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return normalizeCookieObject(JSON.parse(trimmed));
  }
  if (trimmed.includes("=")) return parseCookieString(trimmed);
  return { sessionid: trimmed.replace(/^sessionid=/, "") };
}

function toHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

module.exports = { normalizeCookie, toHeader };
