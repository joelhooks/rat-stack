import { expect, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { preflightPermissions } from "../src/local.js";

it.effect.prop(
  "credential refusal stops at the failed read; every probe uses the pinned credential and GET",
  { refused: Schema.Literals(["none", "zone", "redirects", "workers"]) },
  ({ refused }) =>
    Effect.gen(function* test() {
      const requests: string[] = [];

      const client = HttpClient.make((request) => {
        expect(request.method).toBe("GET");
        expect(request.headers.authorization).toBe("Bearer test-token");
        requests.push(request.url);
        let name = "workers";

        let result: readonly { readonly id: string; readonly name?: string }[] =
          [];

        if (request.url.includes("/zones?")) {
          name = "zone";
          result = [{ id: "test-zone", name: "ratstack.sh" }];
        } else if (request.url.includes("/rulesets?")) {
          name = "redirects";
          result = [{ id: "test-ruleset" }];
        }

        const denied = name === refused;

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(
              { result, success: !denied },
              { status: denied ? 403 : 200 }
            )
          )
        );
      });

      const work = preflightPermissions({
        accountId: Redacted.make("test-account"),
        apiToken: Redacted.make("test-token"),
        type: "apiToken",
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      if (refused === "none") {
        yield* work;
        expect(requests).toHaveLength(3);
      } else {
        const failure = yield* Effect.flip(work);
        expect(failure.step).toBe("preflight");
        expect(JSON.stringify(failure)).not.toContain("test-token");
        const count = { redirects: 2, workers: 3, zone: 1 }[refused];
        expect(requests).toHaveLength(count);
      }
    }),
  { arbitrary: { runs: 100 } }
);
