import { expect, it } from "@effect/vitest";
import {
  JOIN_RETENTION_DEFAULT_LIMIT,
  JOIN_RETENTION_MAX_LIMIT,
  JoinContactStore,
  JoinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Effect, Layer, Schema } from "effect";

import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect.prop(
  "bounded sorted cursor pages cover every terminal id once, and retrying a page preserves its continuation",
  {
    size: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 130 })),
    limit: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
    ),
    dryRun: Schema.Boolean,
  },
  ({ size, limit, dryRun }) =>
    Effect.gen(function* paginationModel() {
      const contacts = yield* JoinContactStore;

      const ids = Array.from(
        { length: size },
        (_value, index) => `synthetic-${String(index).padStart(3, "0")}`
      );

      const visited: { readonly id: string; readonly preview: boolean }[] = [];

      const port: JoinContactStore["Service"] = {
        ...contacts,
        migrateRetention: (id, preview) =>
          Effect.sync(() => {
            visited.push({ id, preview });

            return "gone" as const;
          }),
      };

      const backfill = yield* JoinRetentionBackfill.pipe(
        Effect.provide(
          joinRetentionBackfillLayer(() =>
            Effect.succeed([...ids.toReversed(), ...ids.slice(0, 2)])
          ).pipe(Layer.provide(Layer.succeed(JoinContactStore, port)))
        )
      );

      const effectiveLimit = Math.min(
        limit ?? JOIN_RETENTION_DEFAULT_LIMIT,
        JOIN_RETENTION_MAX_LIMIT
      );

      const covered: string[] = [];
      let after: string | undefined;
      let total = 0;

      do {
        const start = visited.length;
        const previous = after;
        const page = yield* backfill.run(dryRun, after, limit);

        const expected = ids
          .filter((id) => previous === undefined || id > previous)
          .slice(0, effectiveLimit);

        expect(
          visited
            .slice(start)
            .map((visit) => visit.id)
            .toSorted()
        ).toEqual(expected);
        expect(
          visited.slice(start).every((visit) => visit.preview === dryRun)
        ).toBe(true);
        expect(page.gone).toBe(expected.length);
        expect(page.legacyHandoffTimeUnknown).toBe(expected.length);
        expect(page.gone).toBeLessThanOrEqual(JOIN_RETENTION_MAX_LIMIT);
        const replayStart = visited.length;
        expect(yield* backfill.run(dryRun, after, limit)).toEqual(page);
        expect(
          visited
            .slice(replayStart)
            .map((visit) => visit.id)
            .toSorted()
        ).toEqual(expected);
        covered.push(...expected);
        total += page.gone;

        if (page.nextCursor !== null) {
          expect(page.nextCursor).toBe(expected.at(-1));
          expect(previous === undefined || page.nextCursor > previous).toBe(
            true
          );
        }

        after = page.nextCursor ?? undefined;
      } while (after !== undefined);

      expect(covered).toEqual(ids);
      expect(total).toBe(size);
    }).pipe(Effect.provide(JoinContactStore.testLayer))
);
