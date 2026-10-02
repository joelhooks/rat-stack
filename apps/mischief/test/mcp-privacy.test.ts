import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { invokerFor, toCommand } from "@rat-stack/capability";
import { toRpc } from "@rat-stack/capability/rpc";
import { joinInterest } from "@rat-stack/core/join-interest";
import { withEventCapture } from "@rat-stack/events";
import { EventSinkMemory, memoryEventsLayer } from "@rat-stack/events/memory";
import { Effect, Layer, Logger, Schema, Tracer } from "effect";
import { CliOutput, Command } from "effect/cli";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { TestConsole } from "effect/testing";

import {
  legacyMcpProtocols,
  mcpLayer,
  mischiefRoutes,
  modernMcpProtocols,
} from "../src/app.js";
import {
  contentCapabilities,
  executeProjection,
} from "../src/capabilities/index.js";
import { nodeContentLayer as contentLayer } from "../src/node-content.js";
import { TestSandbox } from "./test-sandbox.js";

it.effect(
  "every submission surface keeps applicant data out of telemetry; RPC and code mode refuse the unexposed capability",
  () =>
    Effect.gen(function* privateMcpCalls() {
      const RpcRequest = Schema.TaggedStruct("Request", {
        headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
        id: Schema.String,
        payload: Schema.Json,
        tag: Schema.String,
      });

      const card = {
        agentRef: "synthetic-private-agent",
        answers: { building: "synthetic-private-answer" },
        consent: { contact: true, share: false },
        email: "synthetic-private@example.test",
        ticket: "synthetic-private-ticket",
      } as const;

      for (const surface of ["http", "cli", "rpc", "code-mode"] as const) {
        const spans: Tracer.NativeSpan[] = [];
        const logs: unknown[] = [];

        const telemetry = yield* Layer.build(
          Layer.mergeAll(
            memoryEventsLayer("synthetic-salt"),
            TestConsole.layer,
            CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
            NodeServices.layer,
            Logger.layer([Logger.make(({ message }) => logs.push(message))]),
            Layer.succeed(
              Tracer.Tracer,
              Tracer.make({
                span: (options) => {
                  const span = new Tracer.NativeSpan(options);
                  spans.push(span);

                  return span;
                },
              })
            )
          )
        );

        if (surface === "cli") {
          yield* Command.runWith(toCommand(joinInterest), { version: "0.0.0" })(
            [
              "--agentRef",
              card.agentRef,
              "--email",
              card.email,
              "--ticket",
              card.ticket,
              "--answers",
              JSON.stringify(card.answers),
              "--consent",
              JSON.stringify(card.consent),
            ]
          ).pipe(Effect.provideContext(telemetry));
          expect(
            JSON.stringify(
              yield* TestConsole.logLines.pipe(Effect.provideContext(telemetry))
            )
          ).not.toContain("synthetic-private");
        } else if (surface === "code-mode") {
          expect(executeProjection.declarations).not.toContain("joinInterest");

          const invoke = yield* invokerFor(contentCapabilities).pipe(
            Effect.provide(contentLayer),
            Effect.provideContext(telemetry)
          );

          const refused = yield* invoke("joinInterest", card).pipe(
            Effect.provideContext(telemetry)
          );

          expect(refused.ok).toBe(false);
          expect(JSON.stringify(refused)).toContain("UnknownCapability");
        } else {
          const rpc = toRpc(contentCapabilities);

          const routes =
            surface === "http"
              ? mischiefRoutes().pipe(Layer.provide(TestSandbox), Layer.orDie)
              : RpcServer.layerHttp({
                  group: rpc.group,
                  path: "/rpc",
                  protocol: "http",
                }).pipe(
                  Layer.provide(rpc.layer),
                  Layer.provide(RpcSerialization.layerJson),
                  Layer.provide(contentLayer),
                  Layer.orDie
                );

          const observedRoutes = Layer.provideMerge(
            routes,
            Layer.succeedContext(telemetry)
          );

          const { handler, dispose } = HttpRouter.toWebHandler(observedRoutes, {
            middleware: withEventCapture({
              identityMode: "daily",
              runInBackground: (effect) => effect,
            }),
          });

          yield* Effect.addFinalizer(() => Effect.promise(dispose));

          const response = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request(
                surface === "http"
                  ? "https://ratstack.sh/api/joinInterest"
                  : "https://ratstack.sh/rpc",
                {
                  body: JSON.stringify(
                    surface === "http"
                      ? card
                      : RpcRequest.make({
                          headers: [],
                          id: "private-test",
                          payload: card,
                          tag: "joinInterest",
                        })
                  ),
                  headers: { "content-type": "application/json" },
                  method: "POST",
                }
              ),
              telemetry
            )
          );

          const body = yield* Effect.promise(response.text.bind(response));
          expect(body).not.toContain("synthetic-private");

          if (surface === "http") {
            expect(response.status).toBe(200);
          } else {
            expect(body).toContain('"Failure"');
          }
        }

        const sink = yield* EventSinkMemory.pipe(
          Effect.provideContext(telemetry)
        );

        const observed = JSON.stringify({
          events: yield* sink.events,
          logs,
          spans: spans.map((span) => ({
            attributes: [...span.attributes],
            events: (span._events ?? []).map(([name, _time, attributes]) => ({
              attributes,
              name,
            })),
            name: span.name,
          })),
        });

        expect(observed).not.toContain("synthetic-private");
      }

      for (const protocols of [modernMcpProtocols, legacyMcpProtocols]) {
        const spans: Tracer.NativeSpan[] = [];
        const logs: unknown[] = [];

        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);

            return span;
          },
        });

        const telemetry = yield* Layer.build(
          Layer.mergeAll(
            memoryEventsLayer("synthetic-salt"),
            Logger.layer([Logger.make(({ message }) => logs.push(message))]),
            Layer.succeed(Tracer.Tracer, tracer)
          )
        );

        const routes = mcpLayer(protocols).pipe(
          Layer.provide(contentLayer),
          Layer.provideMerge(
            Layer.mergeAll(TestSandbox, Layer.succeedContext(telemetry))
          )
        );

        const { handler, dispose } = HttpRouter.toWebHandler(routes, {
          middleware: withEventCapture({
            identityMode: "daily",
            runInBackground: (effect) => effect,
          }),
        });

        yield* Effect.addFinalizer(() => Effect.promise(dispose));
        const modern = protocols === modernMcpProtocols;
        const version = modern ? "2026-07-28" : "2025-06-18";

        const headers = new Headers({
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        });

        const send = (body: Schema.Json) =>
          Effect.promise(
            handler.bind(
              undefined,
              new Request("https://ratstack.sh/mcp", {
                body: JSON.stringify(body),
                headers,
                method: "POST",
              }),
              telemetry
            )
          );

        if (modern) {
          headers.set("mcp-protocol-version", version);
          headers.set("mcp-method", "tools/call");
        } else {
          const response = yield* send({
            id: 0,
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              capabilities: {},
              clientInfo: { name: "PrivacyTest", version: "1" },
              protocolVersion: version,
            },
          });

          expect(response.status).toBe(200);
          yield* Effect.promise(response.text.bind(response));
          headers.set(
            "mcp-session-id",
            response.headers.get("mcp-session-id") ?? ""
          );
          headers.set("mcp-protocol-version", version);

          const notified = yield* send({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          });

          expect(notified.status).toBe(202);
        }

        for (const [name, arguments_] of [
          ["search", { query: "synthetic-private-query" }],
          [
            "joinInterest",
            {
              agentRef: "synthetic-private-agent",
              answers: { building: "synthetic-private-answer" },
              consent: { contact: true, share: false },
              email: "synthetic-private@example.test",
              ticket: "synthetic-private-ticket",
            },
          ],
        ] as const) {
          if (modern) {
            headers.set("mcp-name", name);
          }

          const response = yield* send({
            id: 1,
            jsonrpc: "2.0",
            method: "tools/call",
            params: {
              _meta: modern
                ? {
                    "io.modelcontextprotocol/clientCapabilities": {},
                    "io.modelcontextprotocol/clientInfo": {
                      name: "PrivacyTest",
                      version: "1",
                    },
                    "io.modelcontextprotocol/protocolVersion": version,
                  }
                : {},
              arguments: arguments_,
              name,
            },
          });

          const body = yield* Effect.promise(response.text.bind(response));

          expect(response.status, body).toBe(200);
          expect(body).not.toContain('"isError":true');
        }

        const sink = yield* EventSinkMemory.pipe(
          Effect.provideContext(telemetry)
        );

        const observed = JSON.stringify({
          events: yield* sink.events,
          logs,
          spans: spans.map((span) => ({
            attributes: [...span.attributes],
            events: (span._events ?? []).map(([name, _time, attributes]) => ({
              attributes,
              name,
            })),
            name: span.name,
          })),
        });

        expect(observed).not.toContain("synthetic-private");
        expect(spans.some((span) => span.name.endsWith("tools/call"))).toBe(
          false
        );
      }
    }).pipe(Effect.scoped)
);
