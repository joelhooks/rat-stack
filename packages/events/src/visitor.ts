import { AnonymousIdSchema } from "@rat-stack/core/event-sink";
import type { AnonymousId, IdentityMode } from "@rat-stack/core/event-sink";
import { Effect, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";

export const VISITOR_COOKIE = "rat_vid";

const encoder = new TextEncoder();

const isUuid = Schema.is(Schema.String.check(Schema.isUUID()));

export const saltedHash = (salt: string, parts: readonly string[]) =>
  Effect.gen(function* hashWithSalt() {
    const digest = yield* Digest.Digest;

    return yield* digest.digestHex(
      Digest.sha256,
      encoder.encode([salt, ...parts].join("\u0000"))
    );
  });

export const ipHashOf = (input: {
  readonly day: string;
  readonly ip: string;
  readonly mode: IdentityMode;
  readonly salt: string;
}) =>
  saltedHash(
    input.salt,
    input.mode === "daily" ? ["ip", input.day, input.ip] : ["ip", input.ip]
  );

export interface VisitorInput {
  readonly cookie: string | undefined;
  readonly day: string;
  readonly ip: string | undefined;
  readonly mode: IdentityMode;
  readonly salt: string;
  readonly userAgent: string | undefined;
}

export interface Visitor {
  readonly anonymousId: AnonymousId;
  readonly issueCookie: boolean;
}

const anonymousIdOf = Schema.decodeUnknownEffect(AnonymousIdSchema);

export const resolveVisitor = (input: VisitorInput) =>
  Effect.gen(function* resolveVisitorId() {
    if (input.mode === "daily") {
      const hashed = yield* saltedHash(input.salt, [
        "daily",
        input.day,
        input.ip ?? "",
        input.userAgent ?? "",
      ]);

      return {
        anonymousId: yield* anonymousIdOf(hashed),
        issueCookie: false,
      } satisfies Visitor;
    }

    if (input.cookie !== undefined && isUuid(input.cookie)) {
      return {
        anonymousId: yield* anonymousIdOf(input.cookie),
        issueCookie: false,
      } satisfies Visitor;
    }

    const crypto = yield* SecureRandom.SecureRandom;

    return {
      anonymousId: yield* anonymousIdOf(yield* crypto.uuidV7()),
      issueCookie: true,
    } satisfies Visitor;
  });
