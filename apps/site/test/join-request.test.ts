import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { InterestTokens } from "@rat-stack/core/interest";
import { JoinRequest } from "@rat-stack/core/join-interest";
import { Effect, Layer, Logger, Redacted, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { joinRequestMiddleware } from "../src/interest/join-request.js";

it.effect.prop(
  "rate refusals identify only the refusing bucket and missing IP stays silent",
  {
    agentAllowed: Arbitrary.schema(Schema.Boolean),
    ipAllowed: Arbitrary.schema(Schema.Boolean),
    validIp: Arbitrary.schema(Schema.Boolean),
  },
  ({ agentAllowed, ipAllowed, validIp }) =>
    Effect.gen(function* verifyRateGate() {
      const logs: unknown[] = [];
      const keys: string[] = [];

      const services = yield* Layer.build(
        InterestTokens.layer(Redacted.make("synthetic-secret")).pipe(
          Layer.provide(NodeCrypto.layer)
        )
      );

      const routes = Layer.mergeAll(
        HttpRouter.add("GET", "/gate", () =>
          JoinRequest.use((request) =>
            request.allow("private-agent-marker")
          ).pipe(Effect.map((result) => HttpServerResponse.jsonUnsafe(result)))
        ),
        joinRequestMiddleware({
          rateLimits: {
            limit: (_name, key) =>
              Effect.sync(() => {
                keys.push(key);

                return key.startsWith("agent:") ? agentAllowed : ipAllowed;
              }),
          },
          tokens: services,
        })
      ).pipe(
        Layer.provideMerge(
          Logger.layer([Logger.make(({ message }) => logs.push(message))])
        )
      );

      const { handler, dispose } = HttpRouter.toWebHandler(routes, {
        disableLogger: true,
      });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      const request = new Request("https://ratstack.sh/gate", {
        headers: validIp ? { "cf-connecting-ip": "203.0.113.17" } : {},
      });

      const response = yield* Effect.promise(() => handler(request));

      const body = yield* Effect.promise(response.json.bind(response));
      const bucket = ipAllowed ? "agent" : "ip";
      let expected = "unavailable";

      if (validIp) {
        expected = ipAllowed && agentAllowed ? "allowed" : `${bucket}_limited`;
      }

      expect(body).toBe(expected);
      expect(logs).toEqual(
        validIp && !(ipAllowed && agentAllowed)
          ? [["joinInterest rate gate refused", { bucket }]]
          : []
      );
      expect(keys.length).toBe(validIp ? 1 + Number(ipAllowed) : 0);
      expect(JSON.stringify(logs)).not.toContain("203.0.113.17");
      expect(JSON.stringify(logs)).not.toContain("private-agent-marker");
      expect(JSON.stringify(logs)).not.toContain("synthetic-secret");
    }).pipe(Effect.scoped)
);
