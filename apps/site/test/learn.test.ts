import { expect, it } from "@effect/vitest";
import {
  learnDeckContract,
  learnNextContract,
  learnRecordContract,
} from "@rat-stack/core/learn";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";

import { mischiefRoutes } from "../src/app.js";
import { TestSandbox } from "./test-sandbox.js";

it.effect(
  "public HTTP tools round-trip supplied progress without retaining it",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          mischiefRoutes().pipe(Layer.provide(TestSandbox)),
          { disableLogger: true }
        )
      ),
      ({ handler }) =>
        Effect.gen(function* publicProgress() {
          const webHandler: (request: Request) => Promise<Response> = handler;

          const post = Effect.fn("postLearn")(function* postLearn(
            name: string,
            payload: Schema.Json
          ) {
            const response = yield* Effect.promise(
              webHandler.bind(
                undefined,
                new Request(`http://localhost/api/${name}`, {
                  body: JSON.stringify(payload),
                  headers: { "content-type": "application/json" },
                  method: "POST",
                })
              )
            );

            expect(response.status).toBe(200);

            return yield* Effect.promise(response.json.bind(response));
          });

          const deck = yield* Schema.decodeUnknownEffect(
            learnDeckContract.output
          )(yield* post("learnDeck", {}));

          const [card] = deck.cards;

          if (card === undefined) {
            return yield* Effect.die("Expected the generated public deck.");
          }

          const progress = { concepts: [], version: 1 } as const;
          const input = { context: { at: 100, ids: [card.id] }, progress };

          const first = yield* Schema.decodeUnknownEffect(
            learnNextContract.output
          )(yield* post("learnNext", input));

          expect(first.cards[0]?.depth).toBe("walkthrough");
          expect(first.progress).toStrictEqual(progress);

          const recorded = yield* Schema.decodeUnknownEffect(
            learnRecordContract.output
          )(
            yield* post("learnRecord", {
              event: {
                at: 100,
                depth: "walkthrough",
                id: card.id,
                kind: "shown",
                version: 1,
              },
              progress: first.progress,
            })
          );

          const next = yield* Schema.decodeUnknownEffect(
            learnNextContract.output
          )(
            yield* post("learnNext", {
              context: { at: 101, ids: [card.id] },
              progress: recorded,
            })
          );

          expect(next.cards[0]?.depth).toBe("line");

          const fresh = yield* Schema.decodeUnknownEffect(
            learnNextContract.output
          )(yield* post("learnNext", input));

          expect(fresh.cards[0]?.depth).toBe("walkthrough");
          expect(fresh.progress).toStrictEqual(progress);

          return yield* Effect.void;
        }),
      ({ dispose }) => Effect.promise(dispose)
    )
);
