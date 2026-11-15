import { expect, it } from "@effect/vitest";
import type { JoinRetentionCountsSchema } from "@rat-stack/core/join-interest";
import {
  joinRetentionBackfillContract,
  runJoinRetentionWalk,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { remoteJoinRetentionBackfillLayer } from "../scripts/retention-backfill-client.js";

const secret = "synthetic-operator-secret-marker";

const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }));

const pageCounts = Schema.Struct({
  current: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
  erase: count,
  finished: count,
  gone: count,
  legacyHandoffTimeUnknown: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 1 })
  ),
  pending: count,
  unreadable: count,
});

const decodeInput = Schema.decodeUnknownOption(
  Schema.fromJsonString(joinRetentionBackfillContract.input)
);

const empty = {
  current: 0,
  erase: 0,
  finished: 0,
  gone: 0,
  legacyHandoffTimeUnknown: 0,
  pending: 0,
  unreadable: 0,
};

const respond = (body: typeof JoinRetentionCountsSchema.Type) =>
  Promise.resolve(Response.json(body));

const client = remoteJoinRetentionBackfillLayer(
  "https://ratstack.sh",
  Redacted.make(secret)
).pipe(Layer.provide(FetchHttpClient.layer));

it.effect.prop(
  "the operator script follows every cursor and sums only complete validated pages in preview and apply modes",
  {
    pages: Schema.Array(pageCounts).check(Schema.isMaxLength(5)),
    apply: Schema.Boolean,
  },
  ({ pages, apply }) =>
    Effect.gen(function* scriptWalk() {
      const received: (typeof joinRetentionBackfillContract.input.Type)[] = [];

      const fetch: typeof globalThis.fetch = (input, init) => {
        const request = new Request(input, init);
        expect(new URL(request.url).pathname).toBe(
          "/operator/interest/applications/retention-backfill"
        );
        expect(request.headers.get("authorization")).toBe(`Bearer ${secret}`);
        expect(request.redirect).toBe("error");
        expect(request.cache).toBe("no-store");

        return request.text().then((body) => {
          const decoded = decodeInput(body);

          if (Option.isNone(decoded)) {
            return new Response(null, { status: 400 });
          }

          const command = decoded.value;
          received.push(command);

          if (pages.length === 0) {
            return Response.json({ ...empty, nextCursor: null });
          }

          const index =
            command.after === undefined
              ? 0
              : pages.findIndex(
                  (_page, at) => command.after === `cursor-${at + 1}`
                ) + 1;

          const value = pages[index];

          if (value === undefined) {
            return new Response(null, { status: 500 });
          }

          return Response.json({
            ...value,
            nextCursor: index < pages.length - 1 ? `cursor-${index + 1}` : null,
          });
        });
      };

      const total = yield* runJoinRetentionWalk({ apply }).pipe(
        Effect.provide(client),
        Effect.provideService(FetchHttpClient.Fetch, fetch)
      );

      const expected = { ...empty, nextCursor: null };

      for (const page of pages) {
        expected.current += page.current;
        expected.erase += page.erase;
        expected.finished += page.finished;
        expected.gone += page.gone;
        expected.legacyHandoffTimeUnknown += page.legacyHandoffTimeUnknown;
        expected.pending += page.pending;
        expected.unreadable += page.unreadable;
      }

      expect(total).toEqual(expected);
      expect(received.map((page) => page.after)).toEqual(
        pages.length === 0
          ? [undefined]
          : pages.map((_page, index) =>
              index === 0 ? undefined : `cursor-${index}`
            )
      );
      expect(
        received.every((page) => page.apply === apply && page.limit === 25)
      ).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "a failed or invalid page stops the script without successful totals or credential disclosure",
  {
    mode: Schema.Literals([
      "http",
      "network",
      "json",
      "negative",
      "stalled",
      "empty",
      "oversized",
    ]),
  },
  ({ mode }) =>
    Effect.gen(function* failedPage() {
      let calls = 0;

      const fetch: typeof globalThis.fetch = () => {
        calls += 1;

        if (mode !== "empty" && mode !== "oversized" && calls === 1) {
          return respond({ ...empty, current: 1, nextCursor: "cursor-1" });
        }

        if (mode === "network") {
          return Promise.reject(new Error(secret));
        }

        if (mode === "http") {
          return Promise.resolve(new Response(secret, { status: 503 }));
        }

        if (mode === "json") {
          return Promise.resolve(new Response(secret));
        }

        if (mode === "negative") {
          return respond({ ...empty, current: -1, nextCursor: null });
        }

        if (mode === "oversized") {
          return respond({ ...empty, current: 26, nextCursor: null });
        }

        return respond({
          ...empty,
          current: mode === "empty" ? 0 : 1,
          nextCursor: "cursor-1",
        });
      };

      const result = yield* runJoinRetentionWalk({ apply: true }).pipe(
        Effect.provide(client),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).not.toContain(secret);
        expect(Cause.hasFails(result.cause)).toBe(true);
      }

      expect(calls).toBe(mode === "empty" || mode === "oversized" ? 1 : 2);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "unsafe origins fail before sending an operator credential",
  {
    origin: Schema.Literals([
      "not-an-origin",
      "http://fixture.example.test",
      "https://user:password@fixture.example.test",
      "https://fixture.example.test/path",
      "https://fixture.example.test?query=1",
      "https://fixture.example.test#fragment",
    ]),
  },
  ({ origin }) =>
    Effect.gen(function* rejectedOrigin() {
      let calls = 0;

      const fetch: typeof globalThis.fetch = () => {
        calls += 1;

        return respond({ ...empty, nextCursor: null });
      };

      const result = yield* runJoinRetentionWalk({}).pipe(
        Effect.provide(
          remoteJoinRetentionBackfillLayer(origin, Redacted.make(secret)).pipe(
            Layer.provide(FetchHttpClient.layer)
          )
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);
      expect(calls).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "the explicit origin override authorizes previews only, never an apply",
  { apply: Schema.Boolean, override: Schema.Boolean },
  ({ apply, override }) =>
    Effect.gen(function* previewOverride() {
      let calls = 0;

      const fetch: typeof globalThis.fetch = () => {
        calls += 1;

        return respond({ ...empty, nextCursor: null });
      };

      const result = yield* runJoinRetentionWalk({ apply }).pipe(
        Effect.provide(
          remoteJoinRetentionBackfillLayer(
            "https://fixture.example.test",
            Redacted.make(secret),
            { previewOriginOverride: override }
          ).pipe(Layer.provide(FetchHttpClient.layer))
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.exit
      );

      expect(Exit.isSuccess(result)).toBe(override && !apply);
      expect(calls).toBe(override && !apply ? 1 : 0);
    }).pipe(Effect.scoped)
);
