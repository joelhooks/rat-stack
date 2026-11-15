import { expect, it } from "@effect/vitest";
import { InterestTokens } from "@rat-stack/core/interest";
import { JoinContactStore } from "@rat-stack/core/join-interest";
import { Effect, Exit, Layer, Redacted } from "effect";

import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { withMemoryErasure } from "./join-erasure.fixture.js";

it.effect(
  "a storage outage is not unreadable contact data and cannot trigger migration erasure",
  () =>
    Effect.gen(function* unavailableStorage() {
      let erases = 0;

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(
            withMemoryErasure(() => ({
              joinErase: () =>
                Effect.sync(() => {
                  erases += 1;
                }),
              joinRead: () => Effect.die("synthetic storage outage"),
              joinSave: () => Effect.void,
            }))
          ).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-secret"))
            )
          )
        )
      );

      for (const dryRun of [true, false]) {
        const result = yield* contacts
          .migrateRetention("synthetic-submission", dryRun)
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
        expect(erases).toBe(0);
      }
    })
);
