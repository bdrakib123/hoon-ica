/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.listen(callback) - the Instagram inbox listener. Realtime MQTT push when
// options.realtime.enabled is set (see InstaChatOptions), otherwise the inbox
// poller. Both feed the same callback.
module.exports = function (client) {
  return function listen(callback, intervalMs) {
    return client.api.listen(callback, intervalMs || client.options.pollInterval);
  };
};
