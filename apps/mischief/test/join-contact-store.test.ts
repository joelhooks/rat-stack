import { expect, it } from "@effect/vitest";
import {
  ContactRefSchema,
  IntakeEvents,
  IntakeEventsTest,
} from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import { JoinContactStore } from "@rat-stack/core/join-interest";
import { Effect, Layer, Redacted, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";

const Scenario = Schema.Struct({
  score: Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  state: Schema.Literals(["held", "ready", "accepted", "refused"]),
});

it.effect.prop(
  "contact mappings stay sealed, authenticate their submission, and erase with their event key",
  { scenario: Arbitrary.schema(Scenario) },
  ({ scenario }) =>
    Effect.gen(function* sealedMapping() {
      const stored = new Map<string, string>();

      const contactsLayer = joinContactStoreLayer((submissionId) => ({
        joinErase: () =>
          Effect.sync(() => {
            stored.delete(submissionId);
          }),
        joinRead: () => Effect.sync(() => stored.get(submissionId)),
        joinSave: (sealed) =>
          Effect.sync(() => {
            stored.set(submissionId, sealed);
          }),
      }));

      const services = yield* Layer.build(contactsLayer);

      const contacts = yield* JoinContactStore.pipe(
        Effect.provideContext(services)
      );

      const actor =
        yield* Schema.decodeEffect(ContactRefSchema)("test-contact");

      const mapping = {
        agentRef: "private-test-agent",
        clientBucket: { ipHash: "ip-test-hash", uaHash: "ua-test-hash" },
        contactRef: actor,
        email: "fictional@example.test",
        hold: false,
        score: Math.abs(scenario.score),
        signals: ["test"],
        state: scenario.state,
        submissionId: "submission-a",
        ticket: "private-test-ticket",
      };

      yield* contacts.save(mapping);
      expect(stored.size).toBe(1);
      expect([...stored.values()].join(",")).not.toContain(mapping.email);
      expect([...stored.values()].join(",")).not.toContain(mapping.contactRef);
      expect(yield* contacts.read(mapping.submissionId)).toEqual(mapping);
      const sealed = stored.get(mapping.submissionId);
      expect(sealed).toBeDefined();

      if (sealed !== undefined) {
        stored.set("submission-b", sealed);
        expect(
          yield* contacts.read("submission-b").pipe(
            Effect.exit,
            Effect.map((exit) => exit._tag)
          )
        ).toBe("Failure");
        stored.delete("submission-b");
      }

      yield* contacts.setState(mapping.submissionId, "accepted");
      expect((yield* contacts.read(mapping.submissionId))?.state).toBe(
        "accepted"
      );
      yield* contacts.erase(mapping.submissionId);
      expect(yield* contacts.read(mapping.submissionId)).toBeUndefined();
      expect(stored.size).toBe(0);
      expect(yield* IntakeEventsTest.use((test) => test.erased)).toEqual([
        actor,
      ]);
      yield* contacts.erase(mapping.submissionId);
      expect(yield* IntakeEventsTest.use((test) => test.erased)).toEqual([
        actor,
      ]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          InterestTokens.layer(Redacted.make("test-secret")),
          IntakeEvents.testLayer
        )
      )
    )
);
