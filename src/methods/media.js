/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const axios = require("axios");
const { UPLOAD, DOC_ID, EP } = require("../constants");
const { globalAntiSuspension } = require("../utils/antiSuspension");
const { classify, hasGraphQLPartialData } = require("../utils/errors");
const { createPublicLookup } = require("../utils/publicUrlLookup");

const NO_CAPTION_FALLBACK_KINDS = new Set(["rate_limited", "challenge", "blocked", "suspended", "auth"]);

// Instagram's web DM client uploads a file to /ajax/mercury/upload.php and then
// commits the send with the IGDirectMediaSendMutation Relay operation. This is
// the flow captured from a live www.instagram.com session — the old mobile
// rupload_igphoto/rupload_igvideo/configure_* endpoints are not used here.
class MediaMethods {
  constructor(http, identity) {
    this.http = http;
    this.identity = identity;
  }

  _offlineThreadingId() {
    return this.http.offlineThreadingId();
  }

  _threadReferer(threadID) {
    return `https://www.instagram.com/direct/t/${threadID}/`;
  }

  // Maps a MIME type to the rupload consumer segment + the type header the DM
  // composer sends alongside it (video_type/image_type/audio_type/file_type).
  _consumer(contentType = "") {
    if (/^image\/gif/i.test(contentType)) return { consumer: "messenger_gif", typeHeader: "image_type" };
    if (/^image\//i.test(contentType)) return { consumer: "messenger_image", typeHeader: "image_type" };
    if (/^video\//i.test(contentType)) return { consumer: "messenger_video", typeHeader: "video_type" };
    if (/^audio\//i.test(contentType)) return { consumer: "messenger_audio", typeHeader: "audio_type" };
    return { consumer: "messenger_file", typeHeader: "file_type" };
  }

  _uploadLimit(options = {}) {
    const requestedLimit = Number(options.maxUploadBytes);
    return Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 512 * 1024 * 1024)
      : 100 * 1024 * 1024;
  }

  _readFileBuffer(filePath, options = {}) {
    const fs = require("fs");
    const limit = this._uploadLimit(options);
    const stat = fs.statSync(filePath);
    if (stat.size > limit) throw new RangeError(`Media upload exceeds the ${limit}-byte limit`);
    const buffer = fs.readFileSync(filePath);
    if (buffer.length > limit) throw new RangeError(`Media upload exceeds the ${limit}-byte limit`);
    return buffer;
  }

  async _upload(threadID, { buffer, filename, contentType, maxUploadBytes }) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError("Media upload requires a Buffer");
    const uploadLimit = this._uploadLimit({ maxUploadBytes });
    if (buffer.length > uploadLimit) {
      throw new RangeError(`Media upload exceeds the ${uploadLimit}-byte limit`);
    }
    const { consumer, typeHeader } = this._consumer(contentType);

    // Instagram intermittently answers the upload with HTTP 412
    // AuthorizationFailedError even for a valid session; a short backoff retry
    // clears it (observed as a transient rate-limit, not a real auth failure).
    let data;
    for (let attempt = 0; ; attempt++) {
      try {
        data = await this.http.postRupload(consumer, buffer, {
          filename,
          contentType,
          typeHeader,
          referer: this._threadReferer(threadID)
        });
        break;
      } catch (error) {
        const status = error.response?.status;
        const kind = error.igKind || classify(error).kind;
        // AuthorizationFailedError is also used for real auth failures (401/403).
        // Only the observed 412 upload response or an explicitly transient
        // temporary failure should be retried.
        const retriable = status === 412 ||
          (kind === "transient" && /temporary failure/i.test(error.message || ""));
        if (!retriable || attempt >= 2) throw error;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    const mediaId = data?.media_id ?? data?.media_id_str ?? data?.fbid;
    if (!mediaId) {
      throw new Error(`Upload rejected: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { fbid: String(mediaId) };
  }

  // IG prefixes JSON responses with "for (;;);" to defeat JSON hijacking.
  _parseAntiJson(text) {
    const cleaned = String(text).replace(/^for \(;;\);/, "");
    try {
      return JSON.parse(cleaned);
    } catch (_) {
      return null;
    }
  }

  async _commitMedia(threadID, attachmentFbid, options = {}) {
    // A commit can succeed remotely even if its response is lost. Reuse one
    // offline_threading_id for every retry so Instagram can recognize the same
    // logical send instead of creating a second message.
    const offlineThreadingId = this._offlineThreadingId();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.http.postGraphQL(
          "IGDirectMediaSendMutation",
          DOC_ID.MEDIA_SEND,
          {
            attachment_fbid: String(attachmentFbid),
            thread_id: String(threadID),
            offline_threading_id: offlineThreadingId,
            reply_to_message_id: options.replyToMessageId || null,
            forwarded_from_thread_id: null,
            is_forwarded_from_own_message: null
          },
          this._threadReferer(threadID),
          { throwOnError: true }
        );
      } catch (error) {
        // GraphQL field_exception responses are not evidence of a transient
        // transport failure. Retrying them with a new id could duplicate a send;
        // only retry errors classified as transient, always with the same id.
        const kind = error.igKind || classify(error).kind;
        if (kind !== "transient" || attempt >= 2) throw error;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }

  async _send(threadID, uploadOptions, options) {
    // Instagram's DM media mutation has no caption field, so an attachment with
    // text is necessarily two messages. The upload is by far the slow part, so it
    // always runs first: a caption committed mid-upload would render above an
    // image that is still seconds away.
    const metadata = await this._upload(threadID, { ...uploadOptions, maxUploadBytes: options.maxUploadBytes });
    const fbid = metadata.fbid || metadata.video_id || metadata.audio_id;
    if (!fbid) throw new Error(`Upload returned no media id: ${JSON.stringify(metadata)}`);

    // No caption: a plain media send, committed on its own paced turn.
    if (!options.text) {
      let result;
      try {
        await globalAntiSuspension.waitForTurn(threadID, { immediate: false });
        result = await this._commitMedia(threadID, fbid, options);
      } catch (error) {
        globalAntiSuspension.noteSendError(error);
        throw error;
      }
      return result;
    }

    // Captioned send. Committing the text and the media sequentially leaves a
    // visible gap — the recipient sees the caption arrive, then the image a beat
    // later — so both are committed together once the upload has finished. The
    // caption still takes a paced turn (it is a message send); the media joins it
    // immediately (still counted against the volume caps, but without the
    // inter-message gap, so the image lands with the text). Which one renders on
    // top is decided by the message's offline_threading_id, not arrival order: the
    // caption is built first and offlineThreadingId() is strictly increasing per
    // process, so the caption always sorts above the media.
    try {
      await globalAntiSuspension.waitForTurn(threadID);
      const caption = this._sendCaption(threadID, options.text);
      await globalAntiSuspension.waitForTurn(threadID, { immediate: true });
      const media = this._commitMedia(threadID, fbid, options);
      // Promise.all rejects as soon as either half fails, even though the other
      // message may still be committing. Wait for both outcomes so callers get
      // an accurate partial-send report and do not retry while a commit is live.
      const [captionResult, mediaResult] = await Promise.allSettled([caption, media]);
      if (captionResult.status === "rejected" || mediaResult.status === "rejected") {
        const error = captionResult.status === "rejected" ? captionResult.reason : mediaResult.reason;
        if (error && typeof error === "object") {
          error.partialSend = {
            captionSent: captionResult.status === "fulfilled",
            mediaSent: mediaResult.status === "fulfilled"
          };
          if (captionResult.status === "rejected" && mediaResult.status === "rejected") {
            error.mediaError = mediaResult.reason;
          }
        }
        throw error;
      }
      return mediaResult.value;
    } catch (error) {
      globalAntiSuspension.noteSendError(error);
      throw error;
    }
  }

  // Media sends have no caption field, so the attached text is sent as a
  // separate message ahead of the media (same as the app does when you attach a
  // message, except the app shows the typed text above the attachment).
  async _sendCaption(threadID, text) {
    try {
      await this.http.postGraphQL(
        "IGDirectTextSendMutation",
        DOC_ID.TEXT_SEND,
        {
          ig_thread_igid: String(threadID),
          offline_threading_id: this._offlineThreadingId(),
          replied_to_client_context: null,
          replied_to_item_id: null,
          reply_to_message_id: null,
          sampled: null,
          text: { sensitive_string_value: String(text) },
          mentions: [],
          mentioned_user_ids: [],
          commands: null,
          forwarded_from_thread_id: null,
          is_forwarded_from_own_message: null,
          send_attribution: "igd_web_chat_tab:in_thread"
        },
        this._threadReferer(threadID),
        { throwOnError: true }
      );
    } catch (error) {
      const kind = error.igKind || classify(error).kind;
      // Do not replay a caption after a timeout/reset: the GraphQL mutation may
      // have committed even though its response was lost. The legacy fallback is
      // only safe after an explicit GraphQL operation rejection.
      const explicitGraphQLError =
        error.name === "InstagramGraphQLError" &&
        Array.isArray(error.errors) &&
        !hasGraphQLPartialData(error);
      if (!explicitGraphQLError || NO_CAPTION_FALLBACK_KINDS.has(kind)) throw error;
      await this.http.postForm(EP.BROADCAST_TEXT, {
        action: "send_item",
        thread_ids: JSON.stringify([String(threadID)]),
        client_context: this.http.uuid(),
        offline_threading_id: this._offlineThreadingId(),
        text: String(text)
      });
    }
  }

  _waveform(buffer) {
    const samples = [];
    const step = Math.max(1, Math.floor(buffer.length / 200));
    for (let i = 0; i < buffer.length; i += step) {
      samples.push(Math.min(1, (buffer[i] % 128) / 127));
    }
    return samples;
  }

  async sendPhotoBuffer(threadID, buffer, options = {}) {
    return this._send(threadID, {
      buffer,
      filename: options.filename || `photo_${Date.now()}.jpg`,
      contentType: "image/jpeg",
      maxUploadBytes: options.maxUploadBytes
    }, options);
  }

  async sendPhoto(threadID, filePath, options = {}) {
    return this.sendPhotoBuffer(threadID, this._readFileBuffer(filePath, options), options);
  }

  async _downloadFromUrl(url, options = {}) {
    options = options && typeof options === "object" ? options : {};
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (_) {
      throw new TypeError("Media URL must be a valid HTTP or HTTPS URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError("Media URL protocol must be HTTP or HTTPS");
    }
    const requestedLimit = Number(options.maxDownloadBytes);
    const maxDownloadBytes = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 512 * 1024 * 1024)
      : 100 * 1024 * 1024;
    const requestedTimeout = Number(options.downloadTimeoutMs);
    const timeout = Number.isSafeInteger(requestedTimeout) && requestedTimeout > 0
      ? Math.min(requestedTimeout, 120000)
      : 30000;
    let previousProtocol = parsed.protocol;
    const res = await axios.get(parsed.href, {
      responseType: "arraybuffer",
      timeout,
      maxContentLength: maxDownloadBytes,
      maxBodyLength: maxDownloadBytes,
      maxRedirects: 3,
      lookup: createPublicLookup(),
      proxy: false,
      beforeRedirect: (requestOptions) => {
        const nextProtocol = requestOptions.protocol;
        if (nextProtocol !== "http:" && nextProtocol !== "https:") {
          throw new Error("Media URL redirect must use HTTP or HTTPS");
        }
        if (previousProtocol === "https:" && nextProtocol !== "https:") {
          throw new Error("Media URL redirect cannot downgrade HTTPS to HTTP");
        }
        previousProtocol = nextProtocol;
      }
    });
    const buffer = Buffer.from(res.data);
    if (buffer.length > maxDownloadBytes) {
      throw new RangeError(`Downloaded media exceeds the ${maxDownloadBytes}-byte limit`);
    }
    return buffer;
  }

  async sendPhotoFromUrl(threadID, url, options = {}) {
    return this.sendPhotoBuffer(threadID, await this._downloadFromUrl(url, options), options);
  }

  async sendVideoBuffer(threadID, buffer, options = {}) {
    return this._send(threadID, {
      buffer,
      filename: options.filename || `video_${Date.now()}.mp4`,
      contentType: "video/mp4",
      maxUploadBytes: options.maxUploadBytes
    }, options);
  }

  async sendVideo(threadID, filePath, options = {}) {
    return this.sendVideoBuffer(threadID, this._readFileBuffer(filePath, options), options);
  }

  async sendVideoFromUrl(threadID, url, options = {}) {
    return this.sendVideoBuffer(threadID, await this._downloadFromUrl(url, options), options);
  }

  async sendVoiceBuffer(threadID, buffer, options = {}) {
    return this._send(threadID, {
      buffer,
      filename: options.filename || `audioclip-${Date.now()}.ogg`,
      contentType: "audio/ogg",
      maxUploadBytes: options.maxUploadBytes,
      voice: true
    }, options);
  }

  async sendVoice(threadID, filePath, options = {}) {
    return this.sendVoiceBuffer(threadID, this._readFileBuffer(filePath, options), options);
  }

  async sendVoiceFromUrl(threadID, url, options = {}) {
    return this.sendVoiceBuffer(threadID, await this._downloadFromUrl(url, options), options);
  }
}

module.exports = MediaMethods;
