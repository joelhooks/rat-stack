import {
  apiTokenCredentials,
  Credentials,
} from "@distilled.cloud/cloudflare/Credentials";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { readCurrentWorkerVersion } from "../src/local.js";
import { readWorkerVersionSet } from "../src/worker-version-readback.js";
import fixture from "./fixtures/worker-deployments-full-cutover.json" with { type: "json" };

it.effect(
  "the captured ordinary upload qualifies from live history when state has no version ID",
  () =>
    Effect.gen(function* seam() {
      const script = "fixture-mischief-script";

      const observed = yield* readWorkerVersionSet(
        [{ action: "update", attributes: { workerName: script } }],
        { [script]: "00000000-0000-4000-8000-000000000107" },
        (worker) =>
          readCurrentWorkerVersion(
            HttpClientResponse.fromWeb(
              HttpClientRequest.get(
                `https://api.example.test/workers/scripts/${worker}/deployments`
              ),
              Response.json(fixture)
            )
          ),
        { deadlineMs: 0, initialDelayMs: 1, maximumDelayMs: 1 }
      );

      expect(observed.versions).toStrictEqual({
        [script]: "00000000-0000-4000-8000-000000000113",
      });
      expect(observed.checks[0]?.reason).toBe("worker-live-version-confirmed");
      expect(observed.checks[0]?.counts.attempts).toBe(1);
    })
);

it.effect(
  "the typed recovery client agrees with post-apply decoding on the fresh captured response",
  () =>
    Effect.gen(function* seam() {
      const response = yield* Workers.listScriptDeployments({
        accountId: "fixture-account",
        scriptName: "fixture-script",
      }).pipe(
        Effect.provideService(
          Credentials,
          Effect.succeed(apiTokenCredentials({ apiToken: "fixture-token" }))
        ),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, Response.json(fixture))
            )
          )
        ),
        Effect.scoped
      );

      expect(response.deployments[0]?.versions).toStrictEqual([
        { percentage: 100, versionId: "00000000-0000-4000-8000-000000000113" },
      ]);
    })
);
