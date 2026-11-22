/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getAppState()/getCookies() - the current cookie jar as
// [{ key, value, domain, path }].
function readState(client) {
  const jar = client.api.http?.jar;
  if (!jar) return [];
  return jar.getCookiesSync("https://www.instagram.com").map((c) => ({
    key: c.key,
    value: c.value,
    domain: c.domain,
    path: c.path
  }));
}

module.exports = function (client) {
  return function getAppState() {
    return readState(client);
  };
};
