import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { readCurrentWorkerVersion } from "../src/local.js";
import fixture from "./fixtures/worker-deployments.json" with { type: "json" };

type Deployment = Pick<(typeof fixture.result.deployments)[number], "versions">;

interface DeploymentResponse {
  readonly result:
    | { readonly deployments: readonly Deployment[] }
    | readonly Deployment[];
  readonly success: boolean;
}

const responseFor = (body: DeploymentResponse, status = 200) =>
  HttpClientResponse.fromWeb(
    HttpClientRequest.get("https://api.example.test/deployments"),
    Response.json(body, { status })
  );

it.effect(
  "recorded deployment history selects the newest fully deployed version",
  () =>
    Effect.gen(function* test() {
      const version = yield* readCurrentWorkerVersion(responseFor(fixture));

      expect(version).toStrictEqual(
        Option.some("00000000-0000-4000-8000-000000000006")
      );
    })
);

it.effect.prop(
  "only a successful single-version 100-percent deployment establishes a live identity",
  {
    empty: Schema.Boolean,
    httpOk: Schema.Boolean,
    percentage: Schema.Literals([0, 50, 100]),
    split: Schema.Boolean,
    success: Schema.Boolean,
  },
  ({ empty, httpOk, percentage, split, success }) =>
    Effect.gen(function* test() {
      const [newest] = fixture.result.deployments;

      const versions = [
        { percentage, version_id: "candidate" },
        ...(split
          ? [{ percentage: 100 - percentage, version_id: "other" }]
          : []),
      ];

      const body = {
        ...fixture,
        result: {
          deployments: empty
            ? []
            : [{ ...newest, versions }, ...fixture.result.deployments.slice(1)],
        },
        success,
      };

      const observed = yield* readCurrentWorkerVersion(
        responseFor(body, httpOk ? 200 : 503)
      );

      expect(observed).toStrictEqual(
        httpOk && success && !empty && !split && percentage === 100
          ? Option.some("candidate")
          : Option.none()
      );
    }),
  { arbitrary: { runs: 100 } }
);

it.effect(
  "a differently shaped provider body cannot supply a rollback target",
  () =>
    Effect.gen(function* test() {
      const outcome = yield* readCurrentWorkerVersion(
        responseFor({
          ...fixture,
          result: fixture.result.deployments,
        })
      ).pipe(Effect.result);

      expect(outcome._tag).toBe("Failure");
    })
);
