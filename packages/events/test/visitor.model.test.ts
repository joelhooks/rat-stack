import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import { resolveVisitor, webCryptoLayer } from "../src/index.js";
import type { IdentityMode } from "../src/index.js";

const Visit = Schema.Struct({
  device: Schema.Literals([0, 1, 2]),
  keepsCookie: Schema.Boolean,
  startsNewDay: Schema.Boolean,
});

const commands = Arbitrary.array(Arbitrary.schema(Visit), { maxLength: 30 });

const devices = [
  { ip: "203.0.113.1", userAgent: "Mozilla/5.0 rat" },
  { ip: "203.0.113.2", userAgent: "Mozilla/5.0 rat" },
  { ip: "198.51.100.9", userAgent: "curl/8" },
] as const;

const dayOf = (offset: number) =>
  `2026-10-${String(1 + offset).padStart(2, "0")}`;

const runSession = (
  mode: IdentityMode,
  steps: readonly (typeof Visit.Type)[]
) =>
  Effect.gen(function* replaySession() {
    let day = 0;
    const cookies = new Map<number, string>();
    const seen = new Map<string, string>();
    const idsByDay = new Map<number, Set<string>>();

    for (const step of steps) {
      if (step.startsNewDay) {
        day += 1;
      }

      const device = devices[step.device];
      const cookie = step.keepsCookie ? cookies.get(step.device) : undefined;

      const visitor = yield* resolveVisitor({
        cookie,
        day: dayOf(day),
        ip: device.ip,
        mode,
        salt: "model-salt",
        userAgent: device.userAgent,
      });

      if (mode === "persistent") {
        expect(visitor.issueCookie).toBe(cookie === undefined);

        if (cookie !== undefined) {
          expect(visitor.anonymousId).toBe(cookie);
        }

        cookies.set(step.device, visitor.anonymousId);
        continue;
      }

      expect(visitor.issueCookie).toBe(false);
      const key = `${day}|${device.ip}|${device.userAgent}`;
      const previous = seen.get(key);

      if (previous !== undefined) {
        expect(visitor.anonymousId).toBe(previous);
      }

      seen.set(key, visitor.anonymousId);
      const today = idsByDay.get(day) ?? new Set<string>();
      today.add(visitor.anonymousId);
      idsByDay.set(day, today);
    }

    const days = [...idsByDay.values()];

    const repeated = days.flatMap((ids, index) =>
      days
        .slice(index + 1)
        .flatMap((later) => [...ids].filter((id) => later.has(id)))
    );

    expect(repeated).toStrictEqual([]);
  }).pipe(Effect.provide(webCryptoLayer));

describe("visitor identity model", () => {
  it.effect.prop(
    "persistent ids survive every visit that keeps the cookie and are reissued when it is lost",
    { steps: commands },
    ({ steps }) => runSession("persistent", steps)
  );

  it.effect.prop(
    "daily ids are stable within a day, never set a cookie, and never repeat across days",
    { steps: commands },
    ({ steps }) => runSession("daily", steps)
  );
});
