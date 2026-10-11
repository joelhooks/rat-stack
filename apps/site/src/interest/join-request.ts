import { InterestTokens, normalizeClientIp } from "@rat-stack/core/interest";
import { JoinRequest } from "@rat-stack/core/join-interest";
import { Context, Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import type { RateLimits } from "../rate-limits.js";

export const joinRequestMiddleware = (options: {
  readonly rateLimits?: RateLimits | undefined;
  readonly tokens?: Context.Context<InterestTokens> | undefined;
}) =>
  HttpRouter.middleware(
    (effect) =>
      Effect.gen(function* provideJoinRequest() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const ip = normalizeClientIp(request.headers["cf-connecting-ip"]);

        return yield* effect.pipe(
          Effect.provideService(JoinRequest, {
            allow: Effect.fn("JoinRequest.allow")(function* allow(
              agentRef: string
            ) {
              if (
                options.rateLimits === undefined ||
                options.tokens === undefined ||
                Option.isNone(ip)
              ) {
                return false;
              }

              if (
                !(yield* options.rateLimits.limit("INTEREST_PER_IP", ip.value))
              ) {
                return false;
              }

              const tokens = Context.get(options.tokens, InterestTokens);
              const agentBucket = yield* tokens.digest("agent", agentRef);

              return yield* options.rateLimits.limit(
                "INTEREST_PER_IP",
                `agent:${agentBucket}`
              );
            }),
            ip: Option.getOrUndefined(ip),
            userAgent: request.headers["user-agent"] ?? "",
          })
        );
      }),
    { global: true }
  );
