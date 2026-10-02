export { withEventCapture } from "./capture.js";

export type { CaptureOptions } from "./capture.js";

export { EventSink } from "./event-sink.js";

export { EventSinkError } from "./event-sink-error.js";

export { VisitorSalt } from "./visitor-salt.js";

export { capturedQuery, isSensitiveKey, referrerOf } from "./request-facts.js";

export {
  GEO_LABEL_KEYS,
  NEVER_CAPTURED_GEO_KEYS,
  requestGeoOf,
} from "./request-geo.js";

export type { GeoOptions } from "./request-geo.js";

export {
  AnonymousIdSchema,
  EventSourceSchema,
  IdentityModeSchema,
  MessageIdSchema,
  RawEventSchema,
  RequestBodySchema,
  ServerContextSchema,
} from "./schemas.js";

export type {
  AnonymousId,
  EventSource,
  IdentityMode,
  MessageId,
  RawEvent,
  RequestBody,
  ServerContext,
} from "./schemas.js";

export { VISITOR_COOKIE, resolveVisitor, saltedHash } from "./visitor.js";

export type { Visitor, VisitorInput } from "./visitor.js";

export { webCrypto, webCryptoLayer } from "./web-crypto.js";
