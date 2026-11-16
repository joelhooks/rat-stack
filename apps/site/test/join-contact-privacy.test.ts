import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import { JoinContactStore } from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Redacted, Result, Schema } from "effect";

import {
  JOIN_CONTACT_KEY,
  joinContactCell,
} from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";

it.effect.prop(
  "decrypted schema failures contain a fixed unreadable reason and never the plaintext",
  {
    suffix: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 100_000 })
    ),
  },
  ({ suffix }) =>
    Effect.gen(function* privateFailure() {
      const marker = `synthetic-private-score-${suffix}`;
      const id = "synthetic-private-row";

      const tokenLayer = InterestTokens.layer(
        Redacted.make("synthetic-private-key")
      );

      const tokens = yield* InterestTokens.pipe(Effect.provide(tokenLayer));
      const digest = yield* tokens.digest("agent-contact-key", id);

      const bytes = Uint8Array.from(digest.match(/.{2}/gu) ?? [], (value) =>
        Number.parseInt(value, 16)
      );

      const key = yield* Effect.promise(() =>
        crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"])
      );

      const encoder = new TextEncoder();
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const value = {
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
          "synthetic-private-contact"
        ),
        email: "synthetic@example.test",
        hold: false,
        score: marker,
        signals: [],
        state: "ready",
        submissionId: id,
        ticket: "synthetic-ticket",
      };

      const encrypted = yield* Effect.promise(() =>
        crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: encoder.encode(id) },
          key,
          encoder.encode(JSON.stringify(value))
        )
      );

      const entries = new Map<string, unknown>([
        [
          JOIN_CONTACT_KEY,
          JSON.stringify({
            iv: btoa(String.fromCodePoint(...iv)),
            data: btoa(String.fromCodePoint(...new Uint8Array(encrypted))),
          }),
        ],
      ]);

      const cell = joinContactCell({
        get: (name) => Effect.sync(() => entries.get(name)),
        put: (name, item) =>
          Effect.sync(() => {
            entries.set(name, item);
          }),
        delete: (name) => Effect.sync(() => entries.delete(name)),
        setAlarm: () => Effect.void,
      });

      const result = yield* JoinContactStore.use((contacts) =>
        contacts.read(id)
      ).pipe(
        Effect.provide(
          joinContactStoreLayer(() => cell).pipe(Layer.provide(tokenLayer))
        ),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const error = Result.getOrThrow(Cause.findError(result.cause));
        expect(error).not.toHaveProperty("cause");
        const rendered = Cause.pretty(result.cause);
        expect(rendered).toContain("JoinContactUnreadable");
        expect(rendered).not.toContain(marker);
        expect(rendered).not.toContain("synthetic@example.test");
        expect(Cause.hasDies(result.cause)).toBe(false);
      }
    })
);
