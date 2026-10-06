import {
  apiTokenCredentials,
  Credentials,
} from "@distilled.cloud/cloudflare/Credentials";
import * as Workers from "@distilled.cloud/cloudflare/workers";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import fixture from "./fixtures/worker-deployments.json" with { type: "json" };

it.effect(
  "the typed recovery client decodes the captured provider envelope",
  () =>
    Effect.gen(function* test() {
      const response = yield* Workers.listScriptDeployments({
        accountId: "fixture-account",
        scriptName: "fixture-worker",
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
        { percentage: 100, versionId: "00000000-0000-4000-8000-000000000006" },
      ]);
    })
);
