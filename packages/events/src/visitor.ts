import { Crypto, Effect, Schema } from "effect";

import { AnonymousIdSchema } from "./schemas.js";
import type { AnonymousId, IdentityMode } from "./schemas.js";

export const VISITOR_COOKIE = "rat_vid";

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const isUuid = Schema.is(Schema.String.check(Schema.isUUID()));

export const saltedHash = (salt: string, parts: readonly string[]) =>
  Effect.gen(function* hashWithSalt() {
    const crypto = yield* Crypto.Crypto;

    const digest = yield* crypto.digest(
      "SHA-256",
      encoder.encode([salt, ...parts].join("\u0000"))
    );

    return toHex(digest);
  });

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

    const crypto = yield* Crypto.Crypto;

    return {
      anonymousId: yield* anonymousIdOf(yield* crypto.randomUUIDv7),
      issueCookie: true,
    } satisfies Visitor;
  });
