/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Optional namespaced view of the flat FCA surface: client.messages.send(),
// client.threads.getInfo(), client.users.getInfo(), client.account.*,
// client.realtime.*, client.http.*. The flat methods stay the primary API; this
// is a convenience layer for code that prefers namespaces.

function bindOptionalMethod(client, key) {
  const candidate = client[key];
  return typeof candidate === "function" ? candidate.bind(client) : undefined;
}

function compact(namespace) {
  return Object.fromEntries(Object.entries(namespace).filter(([, v]) => v !== undefined));
}

function createFcaClient(client) {
  return {
    raw: client,
    messages: compact({
      send: bindOptionalMethod(client, "sendMessage"),
      sendSync: bindOptionalMethod(client, "sendMessageSync"),
      edit: bindOptionalMethod(client, "editMessage"),
      unsend: bindOptionalMethod(client, "unsendMessage"),
      react: bindOptionalMethod(client, "setMessageReaction"),
      typing: bindOptionalMethod(client, "sendTypingIndicator"),
      markRead: bindOptionalMethod(client, "markAsRead"),
      shareContact: bindOptionalMethod(client, "shareContact"),
      resolvePhotoUrl: bindOptionalMethod(client, "resolvePhotoUrl")
    }),
    threads: compact({
      getInfo: bindOptionalMethod(client, "getThreadInfo"),
      getList: bindOptionalMethod(client, "getThreadList"),
      getHistory: bindOptionalMethod(client, "getThreadHistory"),
      getInbox: bindOptionalMethod(client, "getInbox")
    }),
    users: compact({
      getInfo: bindOptionalMethod(client, "getUserInfo"),
      getInfoV2: bindOptionalMethod(client, "getUserInfoV2"),
      getProfile: bindOptionalMethod(client, "getUserProfile"),
      getProfilePicture: bindOptionalMethod(client, "getProfilePictureV2"),
      getBio: bindOptionalMethod(client, "getProfileBio"),
      getFriendship: bindOptionalMethod(client, "getUserFriendship"),
      getID: bindOptionalMethod(client, "getUserID"),
      getUID: bindOptionalMethod(client, "getUID"),
      getByUsername: bindOptionalMethod(client, "getUserByUsername"),
      getPictureUrl: bindOptionalMethod(client, "getProfilePictureUrl")
    }),
    account: compact({
      getCurrentUserID: bindOptionalMethod(client, "getCurrentUserID"),
      getSelfInfo: bindOptionalMethod(client, "getSelfInfo"),
      getAppState: bindOptionalMethod(client, "getAppState"),
      getCookies: bindOptionalMethod(client, "getCookies"),
      setOptions: bindOptionalMethod(client, "setOptions")
    }),
    realtime: compact({
      listen: bindOptionalMethod(client, "listen"),
      stop: bindOptionalMethod(client, "stopListening"),
      connect: bindOptionalMethod(client, "realtimeConnect"),
      on: bindOptionalMethod(client, "realtimeOn"),
      subscribe: bindOptionalMethod(client, "realtimeSubscribe"),
      ping: bindOptionalMethod(client, "realtimePing"),
      disconnect: bindOptionalMethod(client, "realtimeDisconnect")
    }),
    http: compact({
      get: bindOptionalMethod(client, "httpGet"),
      post: bindOptionalMethod(client, "httpPost")
    })
  };
}

module.exports = { createFcaClient };
