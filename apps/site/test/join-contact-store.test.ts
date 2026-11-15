import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import { Clock, Effect, Exit, Layer, Redacted, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { withMemoryErasure } from "./join-erasure.fixture.js";

const Scenario = Schema.Struct({
  score: Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  state: Schema.Literals(["held", "ready"]),
});

it.effect.prop(
  "contact mappings stay sealed, authenticate their submission, and erase idempotently",
  { scenario: Arbitrary.schema(Scenario) },
  ({ scenario }) =>
    Effect.gen(function* sealedMapping() {
      const stored = new Map<string, string>();

      const contactsLayer = joinContactStoreLayer(
        withMemoryErasure((submissionId) => ({
          joinErase: () =>
            Effect.sync(() => {
              stored.delete(submissionId);
            }),
          joinRead: () => Effect.sync(() => stored.get(submissionId)),
          joinSave: (sealed) =>
            Effect.sync(() => {
              stored.set(submissionId, sealed);
            }),
        }))
      );

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
        retentionDeadlineAt:
          (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS,
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
          Exit.isFailure(yield* contacts.read("submission-b").pipe(Effect.exit))
        ).toBe(true);
        expect(stored.get("submission-b")).toBe(sealed);
        stored.delete("submission-b");
      }

      yield* contacts.setState(mapping.submissionId, "accepted");
      expect(yield* contacts.read(mapping.submissionId)).toBeUndefined();
      yield* contacts.erase(mapping.submissionId);
      expect(yield* contacts.read(mapping.submissionId)).toBeUndefined();
      expect(stored.size).toBe(0);
      yield* contacts.erase(mapping.submissionId);
      expect(stored.size).toBe(0);
    }).pipe(
      Effect.scoped,
      Effect.provide(InterestTokens.layer(Redacted.make("test-secret")))
    )
);
