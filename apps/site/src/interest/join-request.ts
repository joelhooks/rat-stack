import * as Cloudflare from "@alchemy.run/cloudflare";
import { InterestTokens, normalizeClientIp } from "@rat-stack/core/interest";
import { JoinRequest } from "@rat-stack/core/join-interest";
import * as RuntimeContext from "alchemy/RuntimeContext";
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

        const execution = yield* Effect.serviceOption(
          Cloudflare.WorkerExecutionContext
        );

        return yield* effect.pipe(
          Effect.provideService(JoinRequest, {
            afterResponse: (work) =>
              Option.isSome(execution)
                ? execution.value
                    .waitUntil(work)
                    .pipe(Effect.provide(RuntimeContext.RuntimeContext.phantom))
                : work,
            allow: Effect.fn("JoinRequest.allow")(function* allow(
              agentRef: string
            ) {
              if (
                options.rateLimits === undefined ||
                options.tokens === undefined ||
                Option.isNone(ip)
              ) {
                return "unavailable" as const;
              }

              if (
                !(yield* options.rateLimits.limit("INTEREST_PER_IP", ip.value))
              ) {
                yield* Effect.logWarning("joinInterest rate gate refused", {
                  bucket: "ip",
                });

                return "ip_limited" as const;
              }

              const tokens = Context.get(options.tokens, InterestTokens);
              const agentBucket = yield* tokens.digest("agent", agentRef);

              if (
                !(yield* options.rateLimits.limit(
                  "INTEREST_PER_IP",
                  `agent:${agentBucket}`
                ))
              ) {
                yield* Effect.logWarning("joinInterest rate gate refused", {
                  bucket: "agent",
                });

                return "agent_limited" as const;
              }

              return "allowed" as const;
            }),
            ip: Option.getOrUndefined(ip),
            userAgent: request.headers["user-agent"] ?? "",
          })
        );
      }),
    { global: true }
  );
