export { withEventCapture } from "./capture.js";

export type { CaptureOptions } from "./capture.js";

export { EventSink } from "./event-sink.js";

export { EventSinkError } from "./event-sink-error.js";

export { VisitorSalt } from "./visitor-salt.js";

export { capturedQuery, isSensitiveKey, referrerOf } from "./request-facts.js";

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
