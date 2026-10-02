import {
  InvalidTicket,
  IntakeTicket,
  isExpired,
  TICKET_TTL_MILLIS,
  TicketSourceSchema,
} from "@rat-stack/core/intake";
import type { TicketSource } from "@rat-stack/core/intake";
import { Clock, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";

import { TicketBindings } from "./ticket-bindings.js";

const encoder = new TextEncoder();

const TicketPayloadSchema = Schema.Struct({
  n: Schema.String,
  p: Schema.Literal("intake-ticket"),
  s: TicketSourceSchema,
  t: Schema.Finite,
});

const decodePayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(TicketPayloadSchema)
);

const encodePayload = Schema.encodeEffect(
  Schema.fromJsonString(TicketPayloadSchema)
);

const deriveTicketKey = (secret: Redacted.Redacted) =>
  Effect.gen(function* deriveKey() {
    const base = yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
      () =>
        crypto.subtle.importKey(
          "raw",
          encoder.encode(Redacted.value(secret)),
          "HKDF",
          false,
          ["deriveKey"]
        )
    );

    return yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
      () =>
        crypto.subtle.deriveKey(
          {
            hash: "SHA-256",
            info: encoder.encode("ratstack:intake-ticket:v1"),
            name: "HKDF",
            salt: new Uint8Array(0),
          },
          base,
          { hash: "SHA-256", length: 256, name: "HMAC" },
          false,
          ["sign", "verify"]
        )
    );
  });

const randomNonce = Effect.sync(() =>
  Base64Url.encode(crypto.getRandomValues(new Uint8Array(16)))
);

const unknownTicket = new InvalidTicket({ reason: "unknown" });

const ticketParts = (ticket: string) => {
  const [encodedPayload, encodedSignature, ...rest] = ticket.split(".");

  if (
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    rest.length > 0
  ) {
    return Option.none();
  }

  const payload = Base64Url.decodeString(encodedPayload);
  const signature = Base64Url.decode(encodedSignature);

  return Result.isSuccess(payload) && Result.isSuccess(signature)
    ? Option.some({ payload: payload.success, signature: signature.success })
    : Option.none();
};

export const hmacIntakeTicketLayer = (secret: Redacted.Redacted) =>
  Layer.effect(
    IntakeTicket,
    Effect.gen(function* makeHmacTickets() {
      const bindings = yield* TicketBindings;
      const loadKey = yield* Effect.cached(deriveTicketKey(secret));

      const mint = Effect.fn("IntakeTicket.mint")(function* mint(
        source: TicketSource
      ) {
        const key = yield* loadKey;
        const mintedAt = yield* Clock.currentTimeMillis;
        const nonce = yield* randomNonce;

        const payload = yield* encodePayload({
          n: nonce,
          p: "intake-ticket",
          s: source,
          t: mintedAt,
        }).pipe(Effect.orDie);

        const signature = yield* Effect.promise(
          // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
          () => crypto.subtle.sign("HMAC", key, encoder.encode(payload))
        );

        return `${Base64Url.encode(payload)}.${Base64Url.encode(new Uint8Array(signature))}`;
      });

      const verify = Effect.fn("IntakeTicket.verify")(function* verify(
        ticket: string,
        submissionId: string
      ) {
        const found = ticketParts(ticket);

        if (Option.isNone(found)) {
          return yield* unknownTicket;
        }

        const parts = found.value;

        const key = yield* loadKey;

        const valid = yield* Effect.promise(
          // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
          () =>
            crypto.subtle.verify(
              "HMAC",
              key,
              parts.signature,
              encoder.encode(parts.payload)
            )
        );

        if (!valid) {
          return yield* unknownTicket;
        }

        const payload = yield* decodePayload(parts.payload).pipe(
          Effect.mapError(() => unknownTicket)
        );

        const claims = { mintedAt: payload.t, source: payload.s };
        const now = yield* Clock.currentTimeMillis;

        if (isExpired(claims, now)) {
          return yield* new InvalidTicket({ reason: "expired" });
        }

        const binding = yield* bindings.bind(
          payload.n,
          submissionId,
          payload.t + TICKET_TTL_MILLIS
        );

        return binding === "other"
          ? yield* new InvalidTicket({ reason: "reused" })
          : claims;
      });

      return { mint, verify };
    })
  );
