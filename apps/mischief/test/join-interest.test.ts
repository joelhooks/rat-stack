import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  AbuseScore,
  IntakeEvents,
  IntakeTicket,
  PAGE_TICKET_SOURCE,
} from "@rat-stack/core/intake";
import { InterestTokens, SubscriberIntake } from "@rat-stack/core/interest";
import type { AgentIntakeRequest } from "@rat-stack/core/interest";
import {
  JOIN_ANSWER,
  JoinContactStore,
  joinIntakeLayer,
  joinInterestContract,
} from "@rat-stack/core/join-interest";
import { Clock, Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/http";

import {
  apiProjection,
  mischiefRoutes,
  toolkitProjection,
} from "../src/app.js";
import { TestSandbox } from "./test-sandbox.js";

const metadata = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "JoinTest", version: "1" },
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
};

it.effect(
  "HTTP and MCP use the same handler, agent request buckets, and private status answer",
  () =>
    Effect.gen(function* projectedSubmission() {
      const forwarded: AgentIntakeRequest[] = [];
      const gateKeys: string[] = [];

      const dependencies = Layer.mergeAll(
        Layer.succeed(Clock.Clock, yield* Clock.Clock),
        IntakeTicket.testLayer,
        AbuseScore.testLayer(),
        IntakeEvents.testLayer,
        JoinContactStore.testLayer,
        InterestTokens.layer(Redacted.make("test-secret")),
        NodeCrypto.layer,
        Layer.succeed(SubscriberIntake, {
          agent: {
            enabled: true,
            submit: (request) =>
              Effect.sync(() => {
                forwarded.push(request);

                return { kind: "accepted" } as const;
              }),
          },
          submit: () => Effect.succeed({ kind: "refused" } as const),
        })
      );

      const services = yield* Layer.build(
        joinIntakeLayer.pipe(Layer.provideMerge(dependencies))
      );

      const tickets = yield* IntakeTicket.pipe(Effect.provideContext(services));

      const tokens = yield* InterestTokens.pipe(
        Effect.provideContext(services)
      );

      const router = mischiefRoutes({
        joinTokens: services,
        rateLimits: {
          limit: (name, key) =>
            Effect.sync(() => {
              if (name === "INTEREST_PER_IP") {
                gateKeys.push(key);
              }

              return true;
            }),
        },
      }).pipe(
        Layer.provide(
          Layer.mergeAll(Layer.succeedContext(services), TestSandbox)
        )
      );

      const { dispose, handler } = HttpRouter.toWebHandler(router);
      yield* Effect.addFinalizer(() => Effect.promise(dispose));
      const answers = { building: "an agent loop" };

      const card = {
        agentRef: "test-agent",
        answers,
        consent: { contact: true, share: false },
        email: "fictional@example.test",
      };

      const submit = Effect.fnUntraced(function* submit(
        surface: "http" | "mcp"
      ) {
        const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);

        const headers = new Headers({
          "cf-connecting-ip": "203.0.113.31",
          "content-type": "application/json",
          "user-agent": "agent-test",
        });

        if (surface === "mcp") {
          headers.set("MCP-Protocol-Version", "2026-07-28");
          headers.set("Mcp-Method", "tools/call");
          headers.set("Mcp-Name", "joinInterest");
          headers.set("accept", "application/json, text/event-stream");
        }

        const payload = { ...card, ticket };

        const request = new Request(
          surface === "http"
            ? "https://ratstack.sh/api/joinInterest"
            : "https://ratstack.sh/mcp",
          {
            body: JSON.stringify(
              surface === "http"
                ? payload
                : {
                    id: "join",
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: {
                      _meta: metadata,
                      arguments: payload,
                      name: "joinInterest",
                    },
                  }
            ),
            headers,
            method: "POST",
          }
        );

        const response = yield* Effect.promise(
          handler.bind(undefined, request, Context.empty())
        );

        expect(response.status).toBe(200);
        const body = yield* Effect.promise(response.text.bind(response));
        expect(body).not.toContain(card.email);
        expect(body).not.toContain("accepted");

        if (surface === "http") {
          const result = yield* Schema.decodeEffect(
            Schema.fromJsonString(joinInterestContract.output)
          )(body);

          expect(result.message).toBe(JOIN_ANSWER);
        } else {
          expect(body).toContain(JOIN_ANSWER);
          expect(body).toContain("statusRef");
        }
      });

      yield* submit("http");
      yield* submit("mcp");
      expect(forwarded.length).toBe(2);
      expect(
        forwarded.every(
          (request) =>
            request.clientBucket.ipHash === forwarded[0]?.clientBucket.ipHash
        )
      ).toBe(true);
      expect(forwarded[0]?.clientBucket).toEqual({
        ipHash: yield* tokens.digest("ip", "203.0.113.31"),
        uaHash: yield* tokens.digest("ua", "agent-test"),
      });
      expect(gateKeys).toEqual([
        "203.0.113.31",
        `agent:${yield* tokens.digest("agent", card.agentRef)}`,
        "203.0.113.31",
        `agent:${yield* tokens.digest("agent", card.agentRef)}`,
      ]);
      expect(apiProjection.openApi().paths).toHaveProperty("/api/joinInterest");
      expect(toolkitProjection.toolkit.tools).toHaveProperty("joinInterest");
    }).pipe(Effect.scoped)
);
