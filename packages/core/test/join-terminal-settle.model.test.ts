import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { ContactRefSchema } from "../src/intake-events.js";
import { JoinContactStore } from "../src/join-contact-store.js";
import { runJoinDelivery } from "../src/join-delivery-machine.js";
import { scriptedIntakeLayer } from "./fixtures/scripted-intake.js";

it.effect.prop(
  "terminal delivery results erase without reading the payload again",
  { kind: Schema.Literals(["accepted", "refused"]) },
  ({ kind }) =>
    Effect.gen(function* terminalReadTrap() {
      const contacts = yield* JoinContactStore;
      const id = "synthetic-terminal";
      yield* contacts.save({
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
          "synthetic-terminal-contact"
        ),
        email: "synthetic@example.test",
        hold: false,
        pending: "delivery",
        state: "ready",
        score: 0,
        signals: [],
        submissionId: id,
        ticket: "synthetic-ticket",
      });
      let answered = false;

      const result = yield* runJoinDelivery({ submissionId: id }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(JoinContactStore, {
              ...contacts,
              read: (submissionId) =>
                answered
                  ? Effect.die("synthetic terminal read trap")
                  : contacts.read(submissionId),
            }),
            scriptedIntakeLayer({
              agent: {
                submit: () =>
                  Effect.sync(() => {
                    answered = true;

                    return { kind };
                  }),
              },
            })
          )
        )
      );

      expect(result.kind).toBe(kind);
      expect(yield* contacts.read(id)).toBeUndefined();
    }).pipe(Effect.provide(JoinContactStore.testLayer))
);
