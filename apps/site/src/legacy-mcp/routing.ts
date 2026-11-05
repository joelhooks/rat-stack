import { Effect, Schema } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { legacySessionNotFound } from "./session.js";

export interface LegacyMcpRouter {
  readonly forward: (
    session: string,
    request: Request
  ) => Effect.Effect<Response>;
}

export const MODERN_MCP_VERSION = "2026-07-28";

const sessionIdPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

export const JsonRpcEnvelope = Schema.Struct({
  id: Schema.optional(
    Schema.Union([Schema.String, Schema.Finite, Schema.Null])
  ),
  method: Schema.optional(Schema.String),
  params: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.Unknown) })
  ),
});

export const inspectMcpRequest = (
  request: HttpServerRequest.HttpServerRequest
) =>
  Effect.gen(function* inspectRequest() {
    const { source } = request;

    const body: unknown =
      source instanceof Request
        ? yield* Effect.tryPromise(() => source.clone().json())
        : yield* request.json;

    return yield* Schema.decodeUnknownEffect(JsonRpcEnvelope)(body);
  }).pipe(Effect.orElseSucceed(() => null));

interface LegacyRouting {
  readonly envelope: typeof JsonRpcEnvelope.Type | null;
  readonly isMcp: boolean;
  readonly modernMcp: boolean;
}

export const legacySessionOf = Effect.fnUntraced(function* legacySessionOf(
  request: HttpServerRequest.HttpServerRequest,
  routing: LegacyRouting
): Effect.fn.Return<string | null, never, SecureRandom.SecureRandom> {
  if (!routing.isMcp || routing.modernMcp) {
    return null;
  }

  const existing = request.headers["mcp-session-id"];

  if (existing !== undefined) {
    return existing;
  }

  if (routing.envelope?.method !== "initialize") {
    return null;
  }

  const crypto = yield* SecureRandom.SecureRandom;

  return yield* crypto.uuidV4();
});

export const routeLegacyMcp = (
  router: LegacyMcpRouter,
  request: HttpServerRequest.HttpServerRequest,
  session: string,
  routing: Pick<LegacyRouting, "envelope">
) =>
  Effect.gen(function* routeLegacy() {
    if (!sessionIdPattern.test(session)) {
      return HttpServerResponse.fromWeb(
        legacySessionNotFound(routing.envelope?.id)
      );
    }

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    return HttpServerResponse.fromWeb(yield* router.forward(session, web));
  });
