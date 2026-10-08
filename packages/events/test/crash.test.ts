import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { crashArchiveLayer } from "../src/crash-r2.js";
import {
  captureCrashes,
  CrashRecordSchema,
  projectCrash,
} from "../src/crash.js";

const secret = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.map(
    (value) =>
      `PRIVATE_${encodeURIComponent(value.replaceAll(/[\uD800-\uDFFF]/gu, "\uFFFD"))}_END`
  )
);

const version = "a470d540-7b23-4642-8a47-0d6093ec2fef";

const traceFor = (
  header: string,
  cookie: string,
  query: string,
  ip: string
) => ({
  event: {
    request: {
      body: `BODY_${header}`,
      cf: { clientIp: ip },
      headers: {
        Cookie: `session=${cookie}; other=${header}`,
        authorization: `Bearer ${header}`,
        "cf-connecting-ip": ip,
        "x-private": header,
      },
      url: `https://ratstack.sh/lore/init-runs-twice?credential=${encodeURIComponent(query)}`,
    },
  },
  eventTimestamp: 1_791_417_600_000,
  exceptions: [
    {
      message: `Cannot read property '${query}' ${header} ${cookie} ${ip}`,
      name: "TypeError",
      stack: `TypeError: ${header}\n    at handler (worker.js:123:45)\n    at ${cookie} (https://ratstack.sh/${query}?secret=${header}:6:7)\n    at ${query} (worker.js:9:10)`,
    },
  ],
  logs: [{ message: [header, cookie, query, ip] }],
  outcome: "exception",
  scriptVersion: { id: version, message: query, tag: header },
});

const ipv4 = Arbitrary.array(
  Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 254, minimum: 1 }))
  ),
  { maxLength: 4, minLength: 4 }
).pipe(Arbitrary.map((octets) => octets.join(".")));

const stored = Effect.gen(function* makeStore() {
  const writes = yield* Ref.make<readonly { key: string; body: string }[]>([]);

  const layer = crashArchiveLayer(
    (key, body) => Ref.update(writes, (rows) => [...rows, { body, key }]),
    Effect.succeed("b470d540-7b23-4642-8a47-0d6093ec2fef")
  );

  return { layer, writes };
});

describe("privacy-safe crash archive", () => {
  it.effect.prop(
    "stored records exclude generated headers, cookies, IPs and query values, including error echoes",
    { cookie: secret, header: secret, ip: ipv4, query: secret },
    ({ header, cookie, query, ip }) =>
      Effect.gen(function* verifyPrivacy() {
        const { layer, writes } = yield* stored;
        yield* captureCrashes([traceFor(header, cookie, query, ip)]).pipe(
          Effect.provide(layer)
        );
        const rows = yield* Ref.get(writes);
        expect(rows).toHaveLength(1);
        const serialized = JSON.stringify(rows);

        for (const value of [header, cookie, query, ip]) {
          expect(serialized).not.toContain(value);
          expect(serialized).not.toContain(encodeURIComponent(value));
        }

        const record = yield* Schema.decodeEffect(
          Schema.fromJsonString(CrashRecordSchema)
        )(rows[0]?.body ?? "null");

        expect(Object.keys(record).toSorted()).toEqual([
          "eventTime",
          "exceptions",
          "outcome",
          "path",
          "scriptVersion",
        ]);
        expect(record.path).toBe("/lore/init-runs-twice");
        expect(record.scriptVersion).toBe(version);
        expect(record.eventTime).toBe(1_791_417_600_000);
        expect(record.exceptions[0]?.name).toBe("TypeError");
        expect(record.exceptions[0]?.stack).toEqual([
          "worker.js:123:45",
          "worker.js:9:10",
        ]);
      })
  );

  it.effect.prop(
    "unknown exception text stays private even when trace headers are already redacted",
    { value: secret },
    ({ value }) =>
      Effect.gen(function* verifyUnknownText() {
        const trace = traceFor(
          "[redacted]",
          "[redacted]",
          "[redacted]",
          "203.0.113.7"
        );

        const { layer, writes } = yield* stored;
        yield* captureCrashes([
          {
            ...trace,
            exceptions: [
              {
                message: value,
                name: value,
                stack: `${value}\n    at ${value} (worker.js:1:2)`,
              },
            ],
          },
        ]).pipe(Effect.provide(layer));
        expect(JSON.stringify(yield* Ref.get(writes))).not.toContain(value);
      })
  );

  it.effect(
    "keeps a recognized diagnostic while removing its private property name",
    () =>
      Effect.gen(function* verifyDiagnostic() {
        const trace = traceFor("header", "cookie", "query", "203.0.113.7");

        const record = yield* projectCrash({
          ...trace,
          exceptions: [
            {
              message:
                "Cannot read properties of undefined (reading 'private-value')",
              name: "TypeError",
            },
          ],
        });

        expect(record?.exceptions[0]?.message).toBe(
          "Cannot read properties of undefined (reading [quoted])"
        );
      })
  );

  it.effect(
    "stores initialization exceptions with deployment correlation and no fetch event",
    () =>
      Effect.gen(function* verifyStartupException() {
        const { layer, writes } = yield* stored;
        yield* captureCrashes([
          {
            event: null,
            eventTimestamp: 1_791_417_600_000,
            exceptions: [
              {
                message:
                  "Disallowed operation called within global scope: fetch https://ratstack.sh/?token=private",
                name: "Error",
                stack:
                  "Error: startup failed\n    at initialize (worker.js:321:12)",
              },
            ],
            outcome: "exception",
            scriptVersion: { id: version },
          },
        ]).pipe(Effect.provide(layer));
        const rows = yield* Ref.get(writes);

        const record = yield* Schema.decodeEffect(
          Schema.fromJsonString(CrashRecordSchema)
        )(rows[0]?.body ?? "null");

        expect(record.eventTime).toBe(1_791_417_600_000);
        expect(record.scriptVersion).toBe(version);
        expect(record.path).toBeNull();
        expect(record.exceptions).toEqual([
          {
            message: "Disallowed operation called within global scope",
            name: "Error",
            stack: ["worker.js:321:12"],
          },
        ]);
      })
  );

  it.effect("records failures without a fetch event or an exception", () =>
    Effect.gen(function* verifyMissingData() {
      const record = yield* projectCrash({
        event: null,
        eventTimestamp: null,
        exceptions: [],
        outcome: "exceededMemory",
      });

      expect(record).toEqual({
        eventTime: null,
        exceptions: [],
        outcome: "exceededMemory",
        path: null,
        scriptVersion: null,
      });
    })
  );

  it.effect(
    "does not store successful traces and does store rejected background work",
    () =>
      Effect.gen(function* verifyOutcomes() {
        const trace = traceFor("header", "cookie", "query", "203.0.113.7");
        const { layer, writes } = yield* stored;
        yield* captureCrashes([
          { ...trace, exceptions: [], outcome: "ok" },
          { ...trace, outcome: "ok" },
        ]).pipe(Effect.provide(layer));
        expect(yield* Ref.get(writes)).toHaveLength(1);
      })
  );
});
