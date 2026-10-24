import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  JoinContactStore,
  withPending,
  withState,
} from "@rat-stack/core/join-interest";
import { Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";

it.effect(
  "keeps the sweep's pending index in step with each contact's marker and clears it on erase",
  () =>
    Effect.gen(function* pendingIndex() {
      const stored = yield* Ref.make(Option.none<string>());
      const pending = yield* Ref.make<ReadonlySet<string>>(new Set());

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(
            () => ({
              joinErase: () => Ref.set(stored, Option.none()),
              joinRead: () =>
                Ref.get(stored).pipe(Effect.map(Option.getOrUndefined)),
              joinSave: (sealed) => Ref.set(stored, Option.some(sealed)),
            }),
            () => Effect.void,
            (submissionId, marked) =>
              Ref.update(pending, (ids) => {
                const next = new Set(ids);

                if (marked) {
                  next.add(submissionId);
                } else {
                  next.delete(submissionId);
                }

                return next;
              })
          ).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-secret"))
            )
          )
        )
      );

      const contact = {
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef:
          yield* Schema.decodeEffect(ContactRefSchema)("synthetic-contact"),
        email: "synthetic@example.test",
        hold: false,
        score: 0,
        signals: [],
        state: "ready" as const,
        submissionId: "synthetic-submission",
        ticket: "synthetic-ticket",
      };

      yield* contacts.save(withPending(contact, "delivery"));
      expect(yield* Ref.get(pending)).toEqual(new Set([contact.submissionId]));

      yield* contacts.setState(contact.submissionId, "accepted");
      expect(yield* Ref.get(pending)).toEqual(new Set());
      expect(yield* contacts.read(contact.submissionId)).toEqual(
        withState(contact, "accepted")
      );

      yield* contacts.save(withPending(contact, "erase"));
      expect(yield* Ref.get(pending)).toEqual(new Set([contact.submissionId]));

      yield* contacts.erase(contact.submissionId);
      expect(yield* Ref.get(pending)).toEqual(new Set());
      expect(yield* contacts.read(contact.submissionId)).toBeUndefined();
    })
);
