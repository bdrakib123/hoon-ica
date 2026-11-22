/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// A thin per-thread view over an InstaClient, mirroring MessengerContext: it
// remembers the thread id so callers can send/reply/react without repeating it.

class InstaContext {
  constructor(client, threadID) {
    this.client = client;
    this.api = client.api;
    this.threadID = threadID != null ? String(threadID) : null;
    this.userID = client.userID;
  }

  send(form, callback, replyToMessage) {
    return this.client.sendMessage(form, this.threadID, callback, replyToMessage);
  }

  reply(form, callback, messageID) {
    return this.client.sendMessage(form, this.threadID, callback, messageID);
  }

  react(emoji, messageID, callback) {
    return this.client.setMessageReaction(emoji, messageID, callback, this.threadID);
  }

  unsend(messageID, callback) {
    return this.client.unsendMessage(messageID, callback, this.threadID);
  }

  edit(text, messageID, callback) {
    return this.client.editMessage(text, messageID, callback);
  }

  typing() {
    return this.client.sendTypingIndicator(this.threadID);
  }

  getInfo(callback) {
    return this.client.getThreadInfo(this.threadID, callback);
  }

  getHistory(amount, callback) {
    return this.client.getThreadHistory(this.threadID, amount, null, callback);
  }
}

module.exports = { InstaContext };
