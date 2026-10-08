import { describe, expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { crashArchiveLayer } from "../src/crash-r2.js";
import {
  captureCrashes,
  CrashRecordSchema,
  projectCrash,
} from "../src/crash.js";

const secret = Arbitrary.array(
  Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }))
  ),
  { maxLength: 32, minLength: 16 }
).pipe(
  Arbitrary.map(
    (bytes) =>
      `sk_live_${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
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
  logs: [
    {
      level: "error",
      message: [
        header,
        cookie,
        query,
        ip,
        { body: `BODY_${header}`, headers: { authorization: header } },
      ],
    },
  ],
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
    "ordinary exception diagnostics and console text survive while planted credential shapes never reach storage",
    {
      id: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 999_999, minimum: 1 }))
      ),
      value: secret,
    },
    ({ id, value }) =>
      Effect.gen(function* verifyUsefulRedaction() {
        const ordinary = `No event handler found for event type 'tail${id}': handler registration is missing`;

        const credentials = [
          value,
          value.slice("sk_live_".length),
          `Bearer short${id}`,
          `api_key=short${id}`,
          `key=short${id}`,
          `access_token=short${id}`,
          `CLIENT_SECRET=short${id}`,
          `developer${id}@example.test`,
          `https://ratstack.sh/auth.md?token=short${id}&email=developer${id}@example.test`,
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureValue",
          `-----BEGIN PRIVATE KEY-----\nshort${id}\n-----END PRIVATE KEY-----`,
        ];

        const { layer, writes } = yield* stored;
        yield* captureCrashes([
          {
            event: null,
            eventTimestamp: null,
            exceptions: credentials.map((credential) => ({
              message: `${ordinary}; credential detail: ${credential}`,
              name: "Error",
              stack: `Error: ${credential}\n    at initialize (worker.js:321:12)\n    at resume (worker.js:9:10)`,
            })),
            logs: [
              {
                level: "error",
                message: [
                  ordinary,
                  ...credentials,
                  { body: ordinary, headers: { authorization: value } },
                  `{"headers":{"authorization":"${value}"},"body":"${ordinary}"}`,
                ],
              },
            ],
            outcome: "exception",
          },
        ]).pipe(Effect.provide(layer));
        const rows = yield* Ref.get(writes);
        expect(rows).toHaveLength(1);
        const serialized = JSON.stringify(rows);

        for (const credential of credentials) {
          expect(serialized).not.toContain(credential);
        }

        expect(serialized).not.toContain(`short${id}`);
        expect(serialized).not.toContain("authorization");

        const record = yield* Schema.decodeEffect(
          Schema.fromJsonString(CrashRecordSchema)
        )(rows[0]?.body ?? "null");

        for (const exception of record.exceptions) {
          expect(exception.message).toContain(ordinary);
          expect(exception.stack).toEqual([
            "worker.js:321:12",
            "worker.js:9:10",
          ]);
        }

        expect(record.logs?.[0]?.level).toBe("error");
        expect(record.logs?.[0]?.message[0]).toBe(ordinary);
        expect(record.logs?.[0]?.message).toContain("[structured log omitted]");

        const privatePath = yield* projectCrash({
          event: {
            request: {
              headers: {},
              url: `https://ratstack.sh/${value}/developer${id}%40example.test`,
            },
          },
          eventTimestamp: null,
          exceptions: [{ message: ordinary, name: "Error" }],
          outcome: "exception",
        });

        expect(privatePath?.path).toBe("/[redacted]/[email]");
      })
  );

  it.effect.prop(
    "ordinary routes survive short header and query values without substring damage",
    {
      path: Arbitrary.schema(
        Schema.Literals([
          "/apple-touch-icon.png",
          "/apple-touch-icon-precomposed.png",
          "/auth.md",
          "/lore/init-runs-twice",
          "/lore/reliable-diagnostics-preserve-ordinary-error-messages",
          "/mcp",
        ])
      ),
      value: Arbitrary.schema(
        Schema.Literals(["i", "con", "apple", "touch", "init", "md"])
      ),
    },
    ({ path, value }) =>
      Effect.gen(function* verifyPath() {
        const record = yield* projectCrash({
          event: {
            request: {
              headers: { accept: value, "accept-language": value },
              url: `https://ratstack.sh${path}?secret=${value}`,
            },
          },
          eventTimestamp: null,
          exceptions: [
            { message: "Handler registration failed", name: "Error" },
          ],
          outcome: "exception",
        });

        expect(record?.path).toBe(path);
        expect(record?.exceptions[0]?.message).toBe(
          "Handler registration failed"
        );
      })
  );
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
        expect(serialized).not.toContain("BODY_");
        expect(serialized).not.toContain("authorization");
        expect(serialized).not.toContain("cf-connecting-ip");

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
          "logs",
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
    "unknown errors keep credential-shaped values private even when trace headers are already redacted",
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

  it.effect("keeps diagnostic text and an ordinary quoted property name", () =>
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
        "Cannot read properties of undefined (reading 'private-value')"
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
                  "Error: startup failed\n    at initialize (worker.js:321:12)\n    at index.js:9\n    at remote (https://example.test/private.js:8:7)",
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
            message:
              "Disallowed operation called within global scope: fetch https://ratstack.sh/?[redacted]",
            name: "Error",
            stack: ["worker.js:321:12", "index.js:9"],
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
        logs: [],
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
          { ...trace, exceptions: [], outcome: "canceled" },
          { ...trace, exceptions: [], outcome: "exception" },
          { ...trace, outcome: "ok" },
        ]).pipe(Effect.provide(layer));
        const rows = yield* Ref.get(writes);
        expect(rows).toHaveLength(3);

        const canceled = yield* Schema.decodeEffect(
          Schema.fromJsonString(CrashRecordSchema)
        )(rows[0]?.body ?? "null");

        const exceptionOutcome = yield* Schema.decodeEffect(
          Schema.fromJsonString(CrashRecordSchema)
        )(rows[1]?.body ?? "null");

        const background = yield* Schema.decodeEffect(
          Schema.fromJsonString(CrashRecordSchema)
        )(rows[2]?.body ?? "null");

        expect(canceled.logs).toEqual([]);
        expect(exceptionOutcome.logs).toHaveLength(1);
        expect(exceptionOutcome.logs?.[0]?.level).toBe("error");
        expect(background.logs).toHaveLength(1);
        expect(background.logs?.[0]?.level).toBe("error");
      })
  );
});
