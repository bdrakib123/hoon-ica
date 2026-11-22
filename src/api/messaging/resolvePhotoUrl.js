/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Instagram profile pictures are already public HTTPS URLs, so resolving one is
// (close to) identity.
module.exports = function () {
  return function resolvePhotoUrl(url) {
    return url;
  };
};
