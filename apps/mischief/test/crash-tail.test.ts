import { expect, it } from "@effect/vitest";
import { CrashRecordSchema } from "@rat-stack/events/crash";
import { crashArchiveLayer } from "@rat-stack/events/crash-r2";
import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Ref, Schema } from "effect";

import { makeWorkerRuntimeContext } from "../node_modules/alchemy/lib/Cloudflare/Workers/WorkerRuntimeContext.js";
import type { WorkerRuntimeContext } from "../node_modules/alchemy/lib/Cloudflare/Workers/WorkerRuntimeContext.js";
import { registerCrashTail } from "../src/crash-tail-listener.js";

const WorkerHost = Context.Service<Cloudflare.Worker, WorkerRuntimeContext>(
  Cloudflare.Worker.Self.key
);

const trace = {
  cpuTime: 1,
  diagnosticsChannelEvents: [],
  event: {
    request: {
      headers: { "cf-connecting-ip": "203.0.113.7", cookie: "private-cookie" },
      method: "GET",
      url: "https://ratstack.sh/sitemap.xml?private=private-query",
    },
  },
  eventTimestamp: 1_791_428_520_000,
  exceptions: [
    {
      message: "Cannot read properties of undefined (reading 'private-cookie')",
      name: "TypeError",
      stack: "TypeError: private-cookie\n    at initialize (worker.js:123:45)",
      timestamp: 1_791_428_520_000,
    },
  ],
  executionModel: "stateless",
  logs: [],
  outcome: "exception",
  scriptName: "mischief",
  scriptVersion: { id: "a470d540-7b23-4642-8a47-0d6093ec2fef" },
  truncated: false,
  wallTime: 2,
};

it.effect(
  "the real exported tail entry writes one sanitized crash object",
  () =>
    Effect.gen(function* driveExportedTail() {
      const writes = yield* Ref.make<readonly { key: string; body: string }[]>(
        []
      );

      const archive = crashArchiveLayer(
        (key, body) => Ref.update(writes, (rows) => [...rows, { body, key }]),
        Effect.succeed("b470d540-7b23-4642-8a47-0d6093ec2fef")
      );

      const runtime = makeWorkerRuntimeContext("crash-tail-test");

      yield* registerCrashTail.pipe(
        Effect.provide(archive),
        Effect.provideService(WorkerHost, runtime)
      );

      const exported = yield* runtime.exports;
      const entry: unknown = exported.default;

      // SAFETY: beta.80 runtime.exports constructs default.tail with an Effect and its captured Context, as exercised by the pinned runtime tests.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Alchemy erases native event export types to any.
      const tailEntry = entry as {
        readonly tail: (
          events: readonly (typeof trace)[],
          env: Record<string, never>,
          context: Record<string, never>
        ) => readonly [Effect.Effect<void>, Context.Context<never>];
      };

      const [program, services] = tailEntry.tail([trace], {}, {});

      yield* program.pipe(Effect.provide(services));

      const rows = yield* Ref.get(writes);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.key).toMatch(/^crashes\/2026-10-08\/[^/]+\.json$/u);

      const record = yield* Schema.decodeEffect(
        Schema.fromJsonString(CrashRecordSchema)
      )(rows[0]?.body ?? "null");

      expect(record.outcome).toBe("exception");
      expect(record.path).toBe("/sitemap.xml");
      expect(record.eventTime).toBe(trace.eventTimestamp);
      expect(record.scriptVersion).toBe(trace.scriptVersion.id);
      expect(record.exceptions).toEqual([
        {
          message: "Cannot read properties of undefined (reading [quoted])",
          name: "TypeError",
          stack: ["worker.js:123:45"],
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain("private-cookie");
      expect(JSON.stringify(rows)).not.toContain("private-query");
      expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
    })
);
