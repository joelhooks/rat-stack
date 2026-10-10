import { expect, it } from "@effect/vitest";
import { ContactRefSchema, IntakeEvents } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import { JoinContactStore } from "@rat-stack/core/join-interest";
import { Effect, Layer, Redacted, Ref, Schema } from "effect";

import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";

it.effect(
  "retains the contact locator until sealed erasure succeeds and retries either partial failure",
  () =>
    Effect.gen(function* retryErasure() {
      for (const failingStep of ["events", "contact"]) {
        const stored = yield* Ref.make<string | null>(null);
        const fail = yield* Ref.make(true);
        const sealedPresent = yield* Ref.make(true);
        const order = yield* Ref.make<readonly string[]>([]);

        const actor =
          yield* Schema.decodeEffect(ContactRefSchema)("synthetic-contact");

        const contacts = yield* JoinContactStore.pipe(
          Effect.provide(
            joinContactStoreLayer(() => ({
              joinErase: () =>
                Effect.gen(function* eraseContact() {
                  yield* Ref.update(order, (steps) => [...steps, "contact"]);

                  if (failingStep === "contact" && (yield* Ref.get(fail))) {
                    return yield* Effect.die("synthetic-contact-failure");
                  }

                  return yield* Ref.set(stored, null);
                }),
              joinRead: () =>
                Ref.get(stored).pipe(Effect.map((value) => value ?? undefined)),
              joinSave: (sealed) => Ref.set(stored, sealed),
            })).pipe(
              Layer.provide(
                Layer.mergeAll(
                  InterestTokens.layer(Redacted.make("synthetic-secret")),
                  Layer.succeed(IntakeEvents, {
                    erase: () =>
                      Effect.gen(function* eraseEvents() {
                        yield* Ref.update(order, (steps) => [
                          ...steps,
                          "events",
                        ]);

                        if (
                          failingStep === "events" &&
                          (yield* Ref.get(fail))
                        ) {
                          return yield* Effect.die("synthetic-events-failure");
                        }

                        return yield* Ref.set(sealedPresent, false);
                      }),
                    record: () => Effect.void,
                  })
                )
              )
            )
          )
        );

        const mapping = {
          agentRef: "synthetic-agent",
          clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
          contactRef: actor,
          email: "synthetic@example.test",
          hold: false,
          score: 0,
          signals: [],
          state: "accepted" as const,
          submissionId: "synthetic-submission",
          ticket: "synthetic-ticket",
        };

        yield* contacts.save(mapping);
        expect(
          (yield* contacts.erase(mapping.submissionId).pipe(Effect.exit))._tag
        ).toBe("Failure");
        expect(yield* contacts.read(mapping.submissionId)).toEqual(mapping);
        expect(yield* Ref.get(sealedPresent)).toBe(failingStep === "events");
        expect(yield* Ref.get(order)).toEqual(
          failingStep === "events" ? ["events"] : ["events", "contact"]
        );
        yield* Ref.set(fail, false);
        yield* contacts.erase(mapping.submissionId);
        expect(yield* contacts.read(mapping.submissionId)).toBeUndefined();
        expect(yield* Ref.get(sealedPresent)).toBe(false);
        yield* contacts.erase(mapping.submissionId);
        expect(yield* contacts.read(mapping.submissionId)).toBeUndefined();
      }
    }).pipe(Effect.scoped)
);
