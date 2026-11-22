// Type definitions for @cexi/hoonica
// Unofficial Instagram DM chat API.

export interface InstaChatOptions {
  /** Pre-harvested browser session params (__dyn, __csr, __hs, fb_dtsg, ...). */
  sessionParams?: Record<string, string>;
  /** Path to a JSON file holding sessionParams. Defaults to ./session-params.json */
  sessionParamsFile?: string;
  /** Path to the persisted device identity file. Defaults to ./device.json */
  deviceFile?: string;
  /** Polling interval in ms for listen(). Defaults to 15000. */
  pollInterval?: number;
  /** Lowest interval listen() will honour (ms, min 2000). Defaults to 15000. */
  minPollIntervalMs?: number;
  /** Opt listen() into the realtime MQTT push stream. */
  realtime?: RealtimeOptions;
  /**
   * FCA parity. true = also deliver the session's own outbound messages on the
   * event stream, so a bot can answer commands sent from its own account.
   * false (default) = drop them, so a command never replies to itself.
   */
  selfListen?: boolean;
  /**
   * Retry a throttled read (a null/undefined result from Instagram's HTTP 429)
   * before giving up, so a caller that destructures the result does not crash.
   * `false` disables it. Defaults to { attempts: 3, firstWaitMs: 3000,
   * maxWaitMs: 30000 }.
   */
  readRetry?: ReadRetryOptions | false;
  /**
   * Tune (or switch off) the anti-suspension send pacing. A partial
   * SendPacingOptions; `{ enabled: false }` sends with no throttle at all.
   */
  sendPacing?: SendPacingOptions;
  /** login() resolves the native InstaAPI instead of the FCA-shaped InstaClient. */
  native?: boolean;
}

export interface SendPacingOptions {
  /** false sends with no pacing at all. Defaults to true. */
  enabled?: boolean;
  /** Minimum gap between any two sends, in ms. Defaults to 1500. */
  globalMinGapMs?: number;
  /** Minimum gap between two sends to the same thread, in ms. Defaults to 2500. */
  perThreadMinGapMs?: number;
  /** Random jitter added to a gap, in ms. Defaults to 1500. */
  jitterMs?: number;
  /** Length of the stricter "warmup" window after login, in ms. Defaults to 1200000 (20 min). */
  warmupWindowMs?: number;
  /** Hourly send cap during the warmup window. Defaults to 30. */
  warmupHourlyCap?: number;
  /** Hourly send cap afterwards. Defaults to 150. */
  normalHourlyCap?: number;
  /** Daily send cap. Defaults to 1000. */
  dailyCap?: number;
  /** Gap applied once a cap is exceeded, in ms. Defaults to 20000. */
  overCapGapMs?: number;
}

export interface ReadRetryOptions {
  /** Maximum number of attempts (including the first). Defaults to 3; hard cap 10. */
  attempts?: number;
  /** Wait before the first retry, in ms. Defaults to 3000; hard cap five minutes. */
  firstWaitMs?: number;
  /** Upper bound on the wait between attempts, in ms. Defaults to 30000; hard cap five minutes. */
  maxWaitMs?: number;
}

export interface ThreadListItem {
  threadID: string;
  name: string | null;
  snippet: string;
  timestamp: number | null;
  unreadCount: number;
  /** Group flag from the inbox payload's is_group (or the participant count). */
  isGroup: boolean;
}

export interface RealtimeOptions {
  /** Turn realtime MQTT on for listen(). */
  enabled?: boolean;
  /** Fall back to polling when the broker is unreachable. Defaults to true. */
  fallback?: boolean;
  /** Broker host. Defaults to edge-mqtt.facebook.com */
  host?: string;
  /** Keepalive ping interval (ms). Defaults to 25000. */
  keepAliveMs?: number;
  /** Pre-known iris subscription cursor; otherwise read from the inbox query. */
  seqId?: number | string;
  snapshotAtMs?: number;
  /** Resolve the cursor yourself; use a decimal string for values above Number.MAX_SAFE_INTEGER. */
  getRealtimeState?: () => Promise<{ seqId: number | string; snapshotAtMs: number } | null> | { seqId: number | string; snapshotAtMs: number } | null;
  /** Android app version sent in the CONNECT. */
  appVersion?: string;
  /** Android User-Agent sent in the CONNECT. */
  userAgent?: string;
  /** Fired when the connection + subscription are ready. */
  onReady?: (listener: any) => void;
}

export interface SendOptions {
  filename?: string;
  text?: string;
  caption?: string;
  replyToMessageId?: string;
  /** Maximum bytes accepted from URL-based media downloads (default 100 MiB, hard cap 512 MiB). */
  maxDownloadBytes?: number;
  /** Maximum bytes accepted for a media upload (default 100 MiB, hard cap 512 MiB). */
  maxUploadBytes?: number;
  /** URL-based media download timeout in milliseconds (default 30 s, hard cap 120 s). */
  downloadTimeoutMs?: number;
}

export interface PartialAttachmentSend {
  sentCount: number;
  totalAttachments: number;
  messageIDs: string[];
}

export interface PartialCaptionedMediaSend {
  captionSent: boolean;
  mediaSent: boolean;
}

/** Error objects from multi-part sends may carry one of these partialSend details. */
export interface PartialSendError extends Error {
  partialSend?: PartialAttachmentSend | PartialCaptionedMediaSend;
  mediaError?: unknown;
}

export interface Attachment {
  type: string;
  url: string | null;
  caption: string | null;
}

export interface ReplyContext {
  messageID: string;
  senderID: string | null;
  senderName: string | null;
  body: string;
  attachments: Attachment[];
  itemType: string;
  /** Relay client_context of the quoted item (needed to reply-quote it). */
  clientContext?: string | null;
  /** offline_threading_id of the quoted item — IG's replied_to_client_context. */
  offlineThreadingId?: string | null;
  timestamp: number | null;
}

export interface IncomingEvent {
  type: "message" | "message_reply" | "event";
  threadID: string;
  messageID: string;
  senderID?: string | null;
  userID?: string;
  author?: string;
  senderName?: string;
  body?: string | null;
  attachments?: Attachment[];
  itemType?: string;
  repliedToItemId?: string | null;
  /** Raw reply target from inbox / realtime payloads. */
  repliedToMessage?: ReplyContext | null;
  /** FCA-shaped quoted-message context, present when type is message_reply. */
  messageReply?: ReplyContext;
  clientContext?: string | null;
  /** offline_threading_id of the quoted message (informational). */
  offlineThreadingId?: string | null;
  participantIDs?: string[];
  mentions?: Record<string, string>;
  logMessageType?: string;
  logMessageData?: Record<string, any>;
  isGroup?: boolean;
  timestamp: number;
}

export interface ThreadHistoryItem {
  messageID: string;
  item_id: string;
  senderID: string | null;
  user_id: string | null;
  sender_fbid: string | null;
  senderName: string | null;
  body: string;
  text: string;
  itemType: string;
  content_type: string;
  attachments: Attachment[];
  repliedToItemId: string | null;
  repliedToMessage: ReplyContext | null;
  offlineThreadingId: string | null;
  timestamp: number | null;
}

export interface InboxResult {
  threads: any[];
  /** Relay cursor for the next inbox page, or null when there is no next page. */
  nextCursor?: string | null;
  /** Whether Instagram reports another inbox page. */
  hasNextPage?: boolean;
}

// The complete profile Instagram exposes, merged from every source the session
// can read. Fields a source cannot supply stay null.
export interface ProfileInfo {
  id: string | null;
  pk: string | null;
  username: string | null;
  fullName: string | null;
  biography: string;
  externalUrl: string | null;
  category: string | null;
  isVerified: boolean;
  isPrivate: boolean;
  isBusinessAccount: boolean;
  isProfessionalAccount: boolean;
  hasProfilePic: boolean;
  profilePicUrl: string | null;
  profilePicUrlHd: string | null;
  fbid: string | null;
  followerCount: number | null;
  followingCount: number | null;
  mediaCount: number | null;
  highlightReelCount: number | null;
  businessEmail: string | null;
  businessPhone: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  raw: any;
}

export interface ProfilePictureOptions {
  /** Square size for the returned `url` (default 320). */
  size?: number;
  /** Square sizes to populate under `sizes` (default [150, 320, 640, 1080]). */
  sizes?: number[];
}

export interface ProfilePicture {
  id: string | null;
  userID: string | null;
  username: string | null;
  url: string | null;
  hd: string | null;
  thumb: string | null;
  sizes: Record<string, string>;
}

export interface CookieUtils {
  parse(input: string): Record<string, string>;
}

// The FCA / GoatBot-Pro shaped client. Commands written for the Facebook Chat
// API (sendMessage, setMessageReaction, getThreadInfo, ...) run against this.
export declare class InstaClient {
  constructor(instaApi: InstaAPI, options?: InstaChatOptions);

  /** The underlying native client (native sendMessage/sendReaction/...). */
  api: InstaAPI;
  userID: string | null;
  username: string | null;
  http: any;
  /** Most recent edit failure, when an edit could not be completed. */
  lastEditError?: Error | null;
  /** Explicit diagnostic when contact sharing is unsupported by the web adapter. */
  lastShareContactError?: Error | null;

  // messaging
  sendMessage(
    form: string | { body?: string; attachment?: any; attachments?: any[]; maxDownloadBytes?: number; downloadTimeoutMs?: number },
    threadID: string,
    callback?: ((err: any, info: any) => void) | string,
    replyToMessage?: string | { messageID?: string; id?: string }
  ): Promise<{ messageID: string | null; threadID: string; timestamp: number }>;
  sendMessageSync(form: any, threadID: string): Promise<any>;
  editMessage(text: string, messageID: string, callback?: (err: any, res: any) => void): Promise<any>;
  unsendMessage(messageID: string, callback?: (err: any, ok: any) => void): Promise<boolean>;
  setMessageReaction(emoji: string, messageID: string, callback?: (err: any, info: any) => void, threadID?: string | boolean): Promise<any>;
  sendTypingIndicator(threadID: string): Promise<boolean>;
  markAsRead(threadID: string, itemID: string): Promise<boolean>;
  shareContact(uid: string, uid2: string, threadID: string, callback?: (err: any, info: any) => void): Promise<any>;
  resolvePhotoUrl(url: string): string;

  // threads
  getThreadInfo(threadID: string, callback?: (err: any, info: any) => void): Promise<any>;
  getThreadList(limit?: number, timestamp?: any, tags?: any, callback?: (err: any, list: ThreadListItem[]) => void): Promise<ThreadListItem[]>;
  getThreadHistory(threadID: string, callback?: (err: any, items: any[]) => void): Promise<any[]>;
  getThreadHistory(threadID: string, amount: number, callback?: (err: any, items: any[]) => void): Promise<any[]>;
  getThreadHistory(threadID: string, amount: number, timestamp?: any, callback?: (err: any, items: any[]) => void): Promise<any[]>;

  // users
  getUserInfo(ids: string | string[], callback?: (err: any, info: any) => void): Promise<Record<string, any>>;
  getUID(input: string): string | null;
  getProfilePictureUrl(idOrUsername: string): Promise<string | null>;

  // users (V2 profile surface — see ProfileInfo)
  getUserInfoV2(ids: string | string[], callback?: (err: any, info: any) => void): Promise<Record<string, any>>;
  getProfilePictureV2(idOrUsername: string, options?: ProfilePictureOptions, callback?: (err: any, info: any) => void): Promise<ProfilePicture | null>;
  getUserProfile(idOrUsername: string, callback?: (err: any, info: ProfileInfo | null) => void): Promise<ProfileInfo | null>;
  getUserID(idOrUsername: string, callback?: (err: any, id: string | null) => void): Promise<string | null>;
  getProfileBio(idOrUsername: string, callback?: (err: any, info: any) => void): Promise<{ id: string | null; userID: string | null; username: string | null; name: string | null; biography: string }>;
  getUserFriendship(userID: string, callback?: (err: any, info: any) => void): Promise<Record<string, boolean | string | null> | null>;

  // account
  getCurrentUserID(): string | null;
  getSelfInfo(callback?: (err: any, info: any) => void): Promise<Record<string, any> | null>;
  getAppState(): Array<{ key: string; value: string; domain?: string; path?: string }>;
  getCookies(): Array<{ key: string; value: string; domain?: string; path?: string }>;
  setOptions(...args: any[]): boolean;

  // media
  sendPhoto(threadID: string, src: any, opts?: SendOptions, callback?: Function): Promise<any>;
  sendPhotoBuffer(threadID: string, buffer: Buffer, opts?: SendOptions): Promise<any>;
  sendPhotoFromUrl(threadID: string, url: string, opts?: SendOptions, callback?: Function): Promise<any>;
  sendVideoFromUrl(threadID: string, url: string, opts?: SendOptions, callback?: Function): Promise<any>;
  sendVoiceFromUrl(threadID: string, url: string, opts?: SendOptions, callback?: Function): Promise<any>;
  sendVoiceBuffer(threadID: string, buffer: Buffer, opts?: SendOptions): Promise<any>;
  sendVideoBuffer(threadID: string, buffer: Buffer, opts?: SendOptions): Promise<any>;

  // Native methods not overridden by the FCA surface are re-exposed as-is
  // (markThreadSeen, muteThread, unmuteThread, hideThread, getUserInfoByUsername,
  // searchUsers, removeReaction, startTyping, stopTyping, replyToMessage, ...).
  [nativeMethod: string]: any;

  // realtime
  listen(callback: (err: Error | null, event: IncomingEvent | null) => void, intervalMs?: number): () => void;
  stopListening(): void;
  getInbox(cursor?: string): Promise<InboxResult>;
  rememberThread(messageID: string, threadID: string): void;

  // realtime (MQTT) — also on the native client
  realtimeClient(options?: RealtimeOptions): any;
  realtimeConnect(options?: RealtimeOptions): Promise<any>;
  realtimeOn(event: string, handler: (payload: any) => void): this;
  realtimeSubscribe(): Promise<{ seqId: number; snapshotAtMs: number }>;
  realtimePing(): Promise<boolean>;
  realtimeDisconnect(): void;
}

/** Per-thread convenience view over an InstaClient. */
export declare class InstaContext {
  constructor(client: InstaClient, threadID: string | null);
  client: InstaClient;
  threadID: string | null;
  send(form: any, callback?: Function, replyToMessage?: string): Promise<any>;
  reply(form: any, callback?: Function, messageID?: string): Promise<any>;
  react(emoji: string, messageID: string, callback?: Function): Promise<any>;
  unsend(messageID: string, callback?: Function): Promise<any>;
  edit(text: string, messageID: string, callback?: Function): Promise<any>;
  typing(): Promise<boolean>;
  getInfo(callback?: Function): Promise<any>;
  getHistory(amount?: number, callback?: Function): Promise<any[]>;
}

/** Namespaced view: client.messages.send(), client.threads.getInfo(), ... */
export declare function createFcaClient(client: InstaClient): {
  raw: InstaClient;
  messages: Record<string, Function>;
  threads: Record<string, Function>;
  users: Record<string, Function>;
  account: Record<string, Function>;
  realtime: Record<string, Function>;
  http: Record<string, Function>;
};

/** Normalizes a raw Instagram inbox event into the FCA event shape. */
export declare class EventNormalizer {
  constructor(client: InstaClient);
  normalize(raw: any): Promise<any | null>;
}

export declare function loadApiMethods(client: InstaClient): string[];
export declare function wrap(native: InstaAPI, options?: InstaChatOptions): InstaClient;
export declare function createContext(nativeOrClient: InstaAPI | InstaClient, threadID: string): InstaContext;

export interface LoginExport {
  (cookie: string | object, options?: InstaChatOptions & { native?: boolean }): Promise<InstaClient | InstaAPI>;
  (cookie: string | object, callback: (err: Error | null, api: InstaClient | InstaAPI | null) => void): void;
  (cookie: string | object, options: InstaChatOptions & { native?: boolean }, callback: (err: Error | null, api: InstaClient | InstaAPI | null) => void): void;
  InstaAPI: typeof InstaAPI;
  InstaClient: typeof InstaClient;
  InstaContext: typeof InstaContext;
  EventNormalizer: typeof EventNormalizer;
  createClient(cookie: string | object, options?: InstaChatOptions): Promise<InstaClient | InstaAPI>;
  createFcaClient: typeof createFcaClient;
  loadApiMethods: typeof loadApiMethods;
  wrap: typeof wrap;
  createContext: typeof createContext;
  CookieUtils: CookieUtils;
  harvestSessionParams(cookieJar: Record<string, string>, options?: object): Promise<Record<string, string>>;
  findChromium(): string | undefined;
  constants: any;
  moduleLogin: LoginExport;
  RealtimeClient: any;
  RealtimeListener: any;
  utilities: typeof utilities;
  AdaptiveRateLimiter: typeof AdaptiveRateLimiter;
  CircuitBreaker: typeof CircuitBreaker;
  IdempotencyCache: typeof IdempotencyCache;
  Scheduler: typeof Scheduler;
}

export const RealtimeClient: any;
export const RealtimeListener: any;
export const moduleLogin: LoginExport;

export declare class InstaAPI {
  constructor(cookieRaw: string | object, options?: InstaChatOptions);

  userID: string | null;
  username: string | null;

  init(): Promise<{ userID: string | null; username: string | null }>;
  refreshSession(params?: Record<string, string>): Promise<boolean>;
  /** Re-tune outbound send pacing on a live client; see SendPacingOptions. */
  setSendPacing(options?: SendPacingOptions): any;
  getCurrentUserID(): string | null;

  // messaging
  /** replyToItemId is the target message id (item_id / messageID). */
  sendMessage(text: string, threadID: string, replyToItemId?: string | number | { messageID?: string; id?: string } | null): Promise<any>;
  replyToMessage(threadID: string, text: string, replyToItemId?: string | number | { messageID?: string; id?: string } | null): Promise<any>;
  sendLink(threadID: string, link: string, text?: string): Promise<any>;
  unsendMessage(threadID: string, itemID: string): Promise<any>;
  editMessage(threadID: string, itemID: string, text: string): Promise<any>;
  sendReaction(threadID: string, itemID: string, emoji?: string): Promise<any>;
  removeReaction(threadID: string, itemID: string): Promise<any>;
  startTyping(threadID: string): Promise<boolean>;
  stopTyping(threadID: string): Promise<boolean>;

  // threads
  getThreadInfo(threadID: string): Promise<any>;
  getThreadHistory(threadID: string, limit?: number, beforeTimestamp?: number | string): Promise<any[]>;
  markThreadSeen(threadID: string, itemID: string): Promise<any>;
  muteThread(threadID: string): Promise<any>;
  unmuteThread(threadID: string): Promise<any>;
  hideThread(threadID: string): Promise<any>;

  // users
  getUserInfo(userID: string): Promise<any>;
  getUserInfoByUsername(username: string): Promise<any>;
  searchUsers(query: string, limit?: number): Promise<any[]>;
  getUserProfile(idOrUsername: string, opts?: { refresh?: boolean }): Promise<ProfileInfo | null>;
  getProfilePicture(idOrUsername: string, opts?: ProfilePictureOptions): Promise<string | null>;

  // media
  sendPhoto(threadID: string, filePath: string, options?: SendOptions): Promise<any>;
  sendPhotoBuffer(threadID: string, buffer: Buffer, options?: SendOptions): Promise<any>;
  sendPhotoFromUrl(threadID: string, url: string, options?: SendOptions): Promise<any>;
  sendVideo(threadID: string, filePath: string, options?: SendOptions): Promise<any>;
  sendVideoBuffer(threadID: string, buffer: Buffer, options?: SendOptions): Promise<any>;
  sendVideoFromUrl(threadID: string, url: string, options?: SendOptions): Promise<any>;
  sendVoice(threadID: string, filePath: string, options?: SendOptions): Promise<any>;
  sendVoiceBuffer(threadID: string, buffer: Buffer, options?: SendOptions): Promise<any>;
  sendVoiceFromUrl(threadID: string, url: string, options?: SendOptions): Promise<any>;

  // listening
  getInbox(cursor?: string): Promise<InboxResult>;
  listen(callback: (err: Error | null, event: IncomingEvent | null) => void, intervalMs?: number): () => void;
  stopListening(): void;

  // realtime (MQTT)
  realtimeClient(options?: RealtimeOptions): any;
  realtimeConnect(options?: RealtimeOptions): Promise<any>;
  realtimeOn(event: string, handler: (payload: any) => void): this;
  realtimeSubscribe(): Promise<{ seqId: number; snapshotAtMs: number }>;
  realtimePing(): Promise<boolean>;
  realtimeDisconnect(): void;
}

export declare class AdaptiveRateLimiter {
  constructor(options?: { globalMinDelayMs?: number; perUrlBaseDelayMs?: number; maxDelayMs?: number; relaxAfterSuccesses?: number; relaxFactor?: number; bumpFactor?: number });
  recommendDelay(url: string, now?: number): number;
  markRequest(url: string, now?: number): void;
  recordResponse(url: string, responseOrError: any): number;
  snapshot(): Record<string, { delayMs: number; successStreak: number }>;
  reset(): void;
}

export declare class CircuitBreaker {
  constructor(options?: { failureThreshold?: number; cooldownMs?: number; isFailure?: (error: any) => boolean });
  canRequest(key: string): boolean;
  run<T>(key: string, operation: () => Promise<T> | T): Promise<T>;
  state(key: string): "closed" | "open" | "half_open";
  snapshot(): Record<string, { state: string; failures: number; successes: number; probeInFlight: boolean }>;
  reset(key?: string): void;
}

export declare class IdempotencyCache {
  constructor(options?: { ttlMs?: number; maxSize?: number });
  get<T = any>(key: string): T | undefined;
  set<T = any>(key: string, value: T): void;
  run<T>(key: string | null | undefined, operation: () => Promise<T> | T): Promise<T>;
  clear(): void;
}

export declare class Scheduler {
  constructor(options?: { enabled?: boolean });
  on(event: "taskComplete", listener: (event: { name: string; success: true; result?: any }) => void): this;
  on(event: "taskError", listener: (event: { name: string; error: Error }) => void): this;
  schedule(name: string, expression: string, task: () => any, options?: { start?: boolean; timezone?: string }): any;
  scheduleOnce(name: string, delayMs: number, task: () => any): any;
  stop(name: string): boolean;
  start(name: string): boolean;
  remove(name: string): boolean;
  stopAll(): void;
  startAll(): void;
  removeAll(): void;
  list(): Array<{ name: string; expression: string | null; type: "cron" | "once"; running: boolean; timezone?: string }>;
  everyMinute(name: string, task: () => any, options?: { start?: boolean; timezone?: string }): any;
  every5Minutes(name: string, task: () => any, options?: { start?: boolean; timezone?: string }): any;
  every15Minutes(name: string, task: () => any, options?: { start?: boolean; timezone?: string }): any;
  everyHour(name: string, task: () => any, options?: { start?: boolean; timezone?: string }): any;
  daily(name: string, task: () => any, options?: { hour?: number; minute?: number; start?: boolean; timezone?: string }): any;
  weekly(name: string, task: () => any, options?: { day?: number; hour?: number; minute?: number; start?: boolean; timezone?: string }): any;
}

export declare const utilities: {
  AdaptiveRateLimiter: typeof AdaptiveRateLimiter;
  CircuitBreaker: typeof CircuitBreaker;
  IdempotencyCache: typeof IdempotencyCache;
  Scheduler: typeof Scheduler;
};

declare const login: LoginExport;
export default login;
export const createClient: LoginExport["createClient"];
export const CookieUtils: CookieUtils;
export const harvestSessionParams: LoginExport["harvestSessionParams"];
export const findChromium: LoginExport["findChromium"];
export const constants: any;
