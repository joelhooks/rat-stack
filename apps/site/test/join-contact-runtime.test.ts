import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { Effect } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { HttpClient } from "effect/http";

import { eventually, localServices } from "./fixtures/flag-ledger-client.js";
import JoinContactWorker from "./fixtures/join-contact-worker.js";
import { durableObjectStorage } from "./fixtures/local-storage.js";
import { deployScratch } from "./fixtures/scratch-deploy.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `join_contact_runtime_${process.pid}`,
});

test.provider(
  "the real Interest alarm deletes unreadable sealed bytes and preserves the erase marker without a read",
  (stack) =>
    Effect.gen(function* alarmRuntime() {
      const worker = yield* deployScratch(stack, JoinContactWorker);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);
      const random = yield* SecureRandom.SecureRandom;
      const id = yield* random.uuidV4();
      const saved = yield* HttpClient.get(new URL(`/${id}`, url));
      expect(saved.status).toBe(200);
      yield* saved.text;

      const storage = yield* durableObjectStorage(
        "Interest",
        `intake-statement:${id}`
      );

      expect(yield* storage.keys("")).toContain("join-contact");
      expect(yield* storage.alarmPending).toBe(true);
      expect(yield* storage.keys("")).not.toContain("join-erase-request");

      const keys = yield* eventually(
        storage.keys(""),
        (current) =>
          !current.includes("join-contact") &&
          current.includes("join-erase-request")
      );

      expect(keys).toContain("join-erased");
      expect(keys).toContain("join-contact-meta");
      expect(keys).not.toContain("join-contact");
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);
