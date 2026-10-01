import { describe, expect, it } from "@effect/vitest";
import {
  AbuseScore,
  PAGE_TICKET_SOURCE,
  SCORER_UNAVAILABLE,
} from "@rat-stack/core/intake";
import type { AbuseInput } from "@rat-stack/core/intake";
import { Effect, Layer, Option, Predicate, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  JEV_FLAGGED,
  JEV_OFF,
  jevAbuseScoreLayer,
  TYPESAFE_URL,
} from "../src/index.js";
import {
  answerText,
  contactFragments,
  leaksContact,
} from "./contact-shapes.js";

interface Seen {
  readonly auth: string | undefined;
  readonly body: string;
  readonly url: string;
}

const fakeJev = (status: number, noul: number) => {
  const seen: Seen[] = [];

  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const raw = request.body;

      seen.push({
        auth: request.headers.authorization,
        body: Predicate.isTagged(raw, "Uint8Array")
          ? new TextDecoder().decode(raw.body)
          : "",
        url: request.url,
      });

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            {
              answers: { abuse: { noul, type: "noul" } },
              model: "jev-test",
              usage: { input_tokens: 1, output_tokens: 1 },
            },
            { status }
          )
        )
      );
    })
  );

  return { layer, seen };
};

const dead = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die(new Error("network down")))
);

const decodeSentState = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ state: Schema.Json }))
);

const apiKey = Option.some(Redacted.make("typesafe-test-key"));

const inputWith = (answers: AbuseInput["answers"]): AbuseInput => ({
  agentRef: "agent-under-test",
  answers,
  clientBucket: { ipHash: "ip", uaHash: "ua" },
  ticket: { mintedAt: 0, source: PAGE_TICKET_SOURCE },
});

const scoreLater = (input: AbuseInput) =>
  Effect.gen(function* later() {
    yield* TestClock.adjust("1 minute");

    return yield* (yield* AbuseScore).score(input);
  });

describe("jev abuse score", () => {
  it.effect.prop(
    "never sends an email, link, or phone shape to Jev",
    { building: answerText, leaveWith: answerText, today: answerText },
    ({ building, leaveWith, today }) =>
      Effect.gen(function* redactedOnly() {
        const jev = fakeJev(200, 0.1);

        yield* scoreLater(inputWith({ building, leaveWith, today })).pipe(
          Effect.provide(
            jevAbuseScoreLayer({ apiKey }).pipe(Layer.provide(jev.layer))
          )
        );

        for (const request of jev.seen) {
          const sent = JSON.stringify(decodeSentState(request.body).state);

          expect(leaksContact(sent)).toBe(false);

          for (const fragment of contactFragments) {
            expect(sent).not.toContain(fragment);
          }
        }
      })
  );

  it.effect(
    "asks Jev one noul question with the key and holds a high score",
    () =>
      Effect.gen(function* flagged() {
        const jev = fakeJev(200, 0.93);

        const verdict = yield* scoreLater(
          inputWith({ building: "BUY CHEAP TOKENS NOW" })
        ).pipe(
          Effect.provide(
            jevAbuseScoreLayer({ apiKey }).pipe(Layer.provide(jev.layer))
          )
        );

        expect(verdict).toStrictEqual({
          hold: true,
          score: 0.93,
          signals: [JEV_FLAGGED],
        });
        expect(jev.seen).toHaveLength(1);
        expect(jev.seen[0]?.url).toBe(TYPESAFE_URL);
        expect(jev.seen[0]?.auth).toBe("Bearer typesafe-test-key");
        expect(JSON.parse(jev.seen[0]?.body ?? "")).toMatchObject({
          model: "jev-latest",
          questions: { abuse: { type: "noul" } },
          state: { building: "BUY CHEAP TOKENS NOW" },
        });
      })
  );

  it.effect("passes a genuine answer with Jev's score attached", () =>
    Effect.gen(function* clear() {
      const jev = fakeJev(200, 0.04);

      const verdict = yield* scoreLater(
        inputWith({ today: "I run evals for a support bot" })
      ).pipe(
        Effect.provide(
          jevAbuseScoreLayer({ apiKey }).pipe(Layer.provide(jev.layer))
        )
      );

      expect(verdict).toStrictEqual({
        hold: false,
        score: 0.04,
        signals: ["jev_clear"],
      });
    })
  );

  it.effect(
    "scores with code signals only and never calls out without a key",
    () =>
      Effect.gen(function* codeOnly() {
        const jev = fakeJev(200, 1);

        const verdict = yield* scoreLater(
          inputWith({ building: "a harness" })
        ).pipe(
          Effect.provide(
            jevAbuseScoreLayer({ apiKey: Option.none() }).pipe(
              Layer.provide(jev.layer)
            )
          )
        );

        expect(verdict).toStrictEqual({
          hold: false,
          score: 0,
          signals: [JEV_OFF],
        });
        expect(jev.seen).toHaveLength(0);
      })
  );

  it.effect("holds as scorer_unavailable when Jev is down or refuses", () =>
    Effect.gen(function* unavailable() {
      for (const client of [
        dead,
        fakeJev(500, 0).layer,
        fakeJev(200, 7).layer,
      ]) {
        const verdict = yield* scoreLater(
          inputWith({ building: "a harness" })
        ).pipe(
          Effect.provide(
            jevAbuseScoreLayer({ apiKey }).pipe(Layer.provide(client))
          )
        );

        expect(verdict).toStrictEqual({
          hold: true,
          score: 1,
          signals: [SCORER_UNAVAILABLE],
        });
      }
    })
  );

  it.effect(
    "skips Jev when there is nothing to read, and flags junk in code",
    () =>
      Effect.gen(function* nothingToRead() {
        const jev = fakeJev(200, 0);

        const layer = jevAbuseScoreLayer({ apiKey }).pipe(
          Layer.provide(jev.layer)
        );

        const empty = yield* scoreLater(inputWith({})).pipe(
          Effect.provide(layer)
        );

        const junk = yield* scoreLater(
          inputWith({ building: "!!!!!!!!!!!!!!!!!!!!!!!!!!!!" })
        ).pipe(Effect.provide(layer));

        expect(empty).toStrictEqual({
          hold: false,
          score: 0.3,
          signals: ["no_answers"],
        });
        expect(junk.hold).toBe(true);
        expect(junk.signals).toContain("answer_junk");
        expect(jev.seen).toHaveLength(1);
      })
  );
});
