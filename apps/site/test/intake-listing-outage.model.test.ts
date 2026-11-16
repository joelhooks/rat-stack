import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import {
  IntakeApplications,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Schema } from "effect";

import { intakeApplicationsLayer } from "../src/interest/applications.js";

it.effect.prop(
  "listing preserves held rows without history but fails the whole request on storage outages",
  { outage: Schema.Boolean },
  ({ outage }) =>
    Effect.gen(function* listingOutage() {
      const contacts = yield* JoinContactStore;
      const id = "synthetic-listing";
      yield* contacts.save({
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
          "synthetic-listing-contact"
        ),
        email: "synthetic@example.test",
        hold: true,
        state: "held",
        score: 1,
        signals: [],
        submissionId: id,
        ticket: "synthetic-ticket",
      });

      const result = yield* IntakeApplications.use((reader) =>
        reader.list()
      ).pipe(
        Effect.provide(
          intakeApplicationsLayer(
            () => Effect.succeed([id]),
            () => ({
              intakeRead: () =>
                outage
                  ? Effect.die("synthetic storage outage")
                  : Effect.succeed({ key: undefined, rows: [] }),
            })
          ).pipe(Layer.provide(Layer.succeed(JoinContactStore, contacts)))
        ),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(outage);

      if (Exit.isSuccess(result)) {
        expect(result.value).toEqual([
          { reason: "intake history missing", state: "held", submissionId: id },
        ]);
      } else {
        expect(Cause.hasFails(result.cause)).toBe(true);
      }
    }).pipe(Effect.provide(JoinContactStore.testLayer))
);
