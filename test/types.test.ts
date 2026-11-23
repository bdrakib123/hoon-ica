import login, {
  AdaptiveRateLimiter,
  CircuitBreaker,
  IdempotencyCache,
  Scheduler,
  InstaClient,
  InstaAPI,
  InstaContext,
  IncomingEvent,
  SendOptions,
  RealtimeOptions,
  SendPacingOptions,
  PartialSendError,
  utilities
} from "../index";

const limiter: AdaptiveRateLimiter = new login.AdaptiveRateLimiter({ globalMinDelayMs: 10 });
const breaker: CircuitBreaker = new login.CircuitBreaker({ failureThreshold: 3 });
const cache: IdempotencyCache = new login.IdempotencyCache({ ttlMs: 1000 });
const scheduler: Scheduler = new login.Scheduler({ enabled: false });
const namespacedScheduler: Scheduler = new utilities.Scheduler({ enabled: false });

const boundedLimiter: AdaptiveRateLimiter = new login.AdaptiveRateLimiter({ maxEndpoints: 25 });
const boundedBreaker: CircuitBreaker = new login.CircuitBreaker({ maxCircuits: 25 });
const boundedCache: IdempotencyCache = new login.IdempotencyCache({ maxInflight: 25 });


declare const nativeApi: InstaAPI;
declare const fcaClient: InstaClient;
const nullableContext: InstaContext = login.createContext(fcaClient, null);
const cookieArray = login.CookieUtils.parse([{ name: "sessionid", value: "example" }]);
const cookieObject = login.CookieUtils.parse({ sessionid: "example", csrftoken: "example" });

const realtimeCursorResult: Promise<{ seqId: number | string; snapshotAtMs: number }> = nativeApi.realtimeSubscribe();
const fcaRealtimeCursorResult: Promise<{ seqId: number | string; snapshotAtMs: number }> = fcaClient.realtimeSubscribe();

const defaultLogin: Promise<InstaClient> = login("session-cookie");
const explicitNativeLogin: Promise<InstaAPI> = login("session-cookie", { native: true });
const defaultCreateClient: Promise<InstaClient> = login.createClient("session-cookie");
const nativeCreateClient: Promise<InstaAPI> = login.createClient("session-cookie", { native: true });

const nativeModuleLogin: Promise<InstaAPI> = login.moduleLogin("session-cookie");
const nativeModuleLoginWithOptions: Promise<InstaAPI> = login.moduleLogin("session-cookie", { readRetry: false });
const nativeModuleLoginCallback: void = login.moduleLogin("session-cookie", (error, api) => {
  void error;
  if (api) void api.getCurrentUserID();
});

void [
  limiter, breaker, cache, scheduler, namespacedScheduler,
  boundedLimiter, boundedBreaker, boundedCache,
  nullableContext, cookieArray, cookieObject,
  defaultLogin, explicitNativeLogin, defaultCreateClient, nativeCreateClient,
  realtimeCursorResult, fcaRealtimeCursorResult, nativeModuleLogin, nativeModuleLoginWithOptions, nativeModuleLoginCallback
];


void fcaClient.getThreadHistory("thread-1", (error, items) => {
  void error;
  void items;
});
void fcaClient.getThreadHistory("thread-1", 10, (error, items) => {
  void error;
  void items;
});
void fcaClient.getThreadHistory("thread-1", 10, Date.now(), (error, items) => {
  void error;
  void items;
});

declare const incomingEvent: IncomingEvent;
if (incomingEvent.type === "message_reply") {
  void incomingEvent.messageReply?.itemType;
}
if (incomingEvent.type === "event") {
  void incomingEvent.logMessageType;
}

void fcaClient.lastShareContactError;
void fcaClient.lastEditError;

const completeSendPacing: SendPacingOptions = {
  cooldownMs: 60 * 60 * 1000,
  maxCooldownMs: 6 * 60 * 60 * 1000,
  escalationWindowMs: 24 * 60 * 60 * 1000,
  strikesToActivate: 2,
  strikeDecayMs: 30 * 60 * 1000,
  cooldownGapMs: 30000
};
void completeSendPacing;

const sessionOptions: import("../index").InstaChatOptions = {
  appStateFile: "./app-state.json",
  sessionGuardFile: "./session-guard.json",
  sessionGuard: false
};
void sessionOptions;

const mediaOptions: SendOptions = {
  maxDownloadBytes: 20 * 1024 * 1024,
  maxUploadBytes: 40 * 1024 * 1024,
  downloadTimeoutMs: 45000
};
void fcaClient.sendPhotoFromUrl("thread-1", "https://cdn.example/photo.jpg", mediaOptions);
void fcaClient.sendMessage({ body: "caption", attachments: [], maxDownloadBytes: 10_000_000, downloadTimeoutMs: 45000 }, "thread-1");

const partialSendError: PartialSendError = Object.assign(new Error("partial"), {
  partialSend: { captionSent: true, mediaSent: false }
});
void partialSendError.partialSend;

const exactRealtimeCursor: RealtimeOptions = {
  seqId: "9007199254740993",
  snapshotAtMs: Date.now(),
  getRealtimeState: () => ({
    seqId: "9007199254740993",
    snapshotAtMs: Date.now()
  })
};
void exactRealtimeCursor;
