import { expect, it } from "@effect/vitest";
import { Auth } from "@rat-stack/auth";
import { FeedbackIdentity } from "@rat-stack/auth/feedback";
import {
  learnDeckContract,
  learnFeedbackPollContract,
  learnFeedbackStartContract,
  LearnUnauthenticated,
} from "@rat-stack/core/learn";
import { RuntimeContext } from "alchemy";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter } from "effect/http";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { mischiefRoutes } from "../src/app.js";
import { feedbackBindingAccess } from "../src/auth/binding-client.js";
import { privateFeedbackRoutes } from "../src/auth/private-worker.js";
import { TestSandbox } from "./test-sandbox.js";

type WebHandler = (request: Request) => Promise<Response>;

const post = Effect.fn("postFeedback")(function* post(
  handler: WebHandler,
  path: string,
  body: Schema.Json,
  cookie?: string
) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://auth.test",
  });

  if (cookie !== undefined) {
    headers.set("cookie", cookie);
  }

  return yield* Effect.promise(
    handler.bind(
      undefined,
      new Request(`http://auth.test${path}`, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      })
    )
  );
});

const get = (handler: WebHandler, path: string) =>
  Effect.promise(
    handler.bind(undefined, new Request(`http://auth.test${path}`))
  );

const bodyText = (response: Response) =>
  Effect.promise(response.text.bind(response));

const mcpRequest = Effect.fn("feedbackMcpRequest")(function* mcpRequest(
  handler: WebHandler,
  method: "tools/list" | "tools/call",
  params: Readonly<Record<string, Schema.Json>>
) {
  const headers = new Headers({
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });

  if (method === "tools/call") {
    const name = yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.isNonEmpty())
    )(params.name).pipe(Effect.orDie);

    headers.set("Mcp-Name", name);
  }

  const response = yield* Effect.promise(
    handler.bind(
      undefined,
      new Request("http://auth.test/mcp", {
        body: JSON.stringify({
          id: "feedback-test",
          jsonrpc: "2.0",
          method,
          params: {
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "FeedbackTest",
                version: "1",
              },
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            },
            ...params,
          },
        }),
        headers,
        method: "POST",
      })
    )
  );

  expect(response.status).toBe(200);

  return yield* Effect.promise(response.json.bind(response)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
    Effect.orDie
  );
});

const ToolList = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
});

const ToolReply = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({ text: Schema.String, type: Schema.Literal("text") })
    ),
    isError: Schema.optionalKey(Schema.Boolean),
  }),
});

const listTools = Effect.fn("listFeedbackTools")(function* listTools(
  handler: WebHandler
) {
  const reply = yield* mcpRequest(handler, "tools/list", {}).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ToolList)),
    Effect.orDie
  );

  return reply.result.tools.map((tool) => tool.name);
});

const requestRuntime = RuntimeContext.of({
  Type: "worker",
  env: {},
  get: <Value>() => Effect.succeed(Option.getOrUndefined(Option.none<Value>())),
  id: "feedback-http-test",
  set: (id) => Effect.succeed(id),
  telemetry: Layer.empty,
});

const privateMemoryRoutes = Layer.unwrap(
  Effect.gen(function* authRoutes() {
    const auth = yield* Auth;
    const identity = yield* FeedbackIdentity;

    return privateFeedbackRoutes(auth, identity);
  })
).pipe(
  Layer.provide(
    FeedbackIdentity.layer.pipe(
      Layer.provideMerge(
        Auth.memoryLayer("feedback-http-secret-with-enough-entropy", {
          baseURL: "http://auth.test",
        })
      )
    )
  ),
  Layer.provideMerge(Layer.succeed(RuntimeContext, requestRuntime))
);

const enabledRoutes = Layer.unwrap(
  Effect.gen(function* boundFeedbackRoutes() {
    const privateServer = HttpRouter.toWebHandler(privateMemoryRoutes, {
      disableLogger: true,
      middleware: (httpEffect) =>
        httpEffect.pipe(Effect.provideService(RuntimeContext, requestRuntime)),
    });

    yield* Effect.addFinalizer(() => Effect.promise(privateServer.dispose));

    const send = Effect.fn("privateBindingFetch")(function* send(
      request: HttpClientRequest.HttpClientRequest
    ) {
      const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie);

      const response = yield* Effect.promise(
        privateServer.handler.bind(undefined, web, Context.empty())
      ).pipe(Effect.orDie);

      return HttpClientResponse.fromWeb(request, response);
    });

    return mischiefRoutes({ feedback: feedbackBindingAccess(send) });
  })
).pipe(Layer.provide(TestSandbox));

it.effect(
  "flag-off HTTP, phone, OpenAPI, and MCP expose no feedback authentication",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          mischiefRoutes().pipe(Layer.provide(TestSandbox)),
          { disableLogger: true }
        )
      ),
      ({ handler }) =>
        Effect.gen(function* disabledSurface() {
          for (const path of [
            "/learn/approve",
            "/learn/approve.js",
            "/auth/get-session",
            "/private/feedbackAuthorSave",
          ]) {
            expect((yield* get(handler, path)).status).toBe(404);
          }

          for (const name of [
            "learnFeedbackStart",
            "learnFeedbackPoll",
            "learnFeedback",
          ]) {
            expect((yield* post(handler, `/api/${name}`, {})).status).toBe(404);
          }

          expect(
            yield* bodyText(yield* get(handler, "/openapi.json"))
          ).not.toContain("learnFeedback");
          const tools = yield* listTools(handler);
          expect(tools).toContain("learnDeck");
          expect(tools).not.toContain("learnFeedbackStart");
          expect(tools).not.toContain("learnFeedbackPoll");
          expect(tools).not.toContain("learnFeedback");
        }),
      ({ dispose }) => Effect.promise(dispose)
    )
);

it.effect(
  "a signed-out phone and an agent complete the real feedback-only HTTP path",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(enabledRoutes, {
          disableLogger: true,
          middleware: (httpEffect) =>
            httpEffect.pipe(
              Effect.provideService(RuntimeContext, requestRuntime)
            ),
        })
      ),
      ({ handler }) =>
        Effect.gen(function* recipientFlow() {
          const page = yield* get(handler, "/learn/approve");
          expect(page.status).toBe(200);
          expect(page.headers.get("cache-control")).toBe("no-store");
          expect(page.headers.get("content-security-policy")).toContain(
            "script-src 'self'"
          );
          expect(yield* bodyText(page)).toContain("Approve feedback only");
          expect((yield* get(handler, "/learn/approve.js")).status).toBe(200);
          expect(
            yield* bodyText(yield* get(handler, "/openapi.json"))
          ).toContain("learnFeedback");
          expect(yield* listTools(handler)).toContain("learnFeedback");
          expect(
            (yield* post(handler, "/api/learnFeedbackPoll", {
              deviceCode: "unknown",
            })).status
          ).toBe(401);
          const started = yield* post(handler, "/api/learnFeedbackStart", {});
          expect(started.status).toBe(200);

          const request = yield* Effect.promise(
            started.json.bind(started)
          ).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(learnFeedbackStartContract.output)
            ),
            Effect.orDie
          );

          expect(request.verificationUrl).toContain(
            "/learn/approve?user_code="
          );
          expect(
            (yield* post(handler, "/auth/device/approve", {
              userCode: request.userCode,
            })).status
          ).toBe(401);

          const signup = yield* post(handler, "/auth/sign-up/email", {
            email: "http-feedback@example.com",
            name: "Feedback Reader",
            password: "password1234",
          });

          expect(signup.status).toBe(200);

          const cookie = signup.headers
            .getSetCookie()
            .map((part) => part.split(";")[0])
            .join("; ");

          expect(
            (yield* post(
              handler,
              "/auth/device/approve",
              { userCode: request.userCode },
              cookie
            )).status
          ).toBe(200);

          const polled = yield* post(handler, "/api/learnFeedbackPoll", {
            deviceCode: request.deviceCode,
          });

          expect(polled.status).toBe(200);

          const result = yield* Effect.promise(polled.json.bind(polled)).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(learnFeedbackPollContract.output)
            ),
            Effect.orDie
          );

          if (result.state !== "approved") {
            return yield* Effect.die(
              new Error("Approved device did not issue a feedback credential")
            );
          }

          const deckResponse = yield* post(handler, "/api/learnDeck", {});

          const deck = yield* Effect.promise(
            deckResponse.json.bind(deckResponse)
          ).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(learnDeckContract.output)
            ),
            Effect.orDie
          );

          const [card] = deck.cards;

          if (card === undefined) {
            return yield* Effect.die(new Error("Public deck has no card"));
          }

          const rejected = yield* post(handler, "/api/learnFeedback", {
            cardId: card.id,
            feedback: "Clear example.",
            token: "not-a-token",
          });

          expect(rejected.status).toBe(401);

          const failure = yield* Effect.promise(
            rejected.json.bind(rejected)
          ).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(LearnUnauthenticated)),
            Effect.orDie
          );

          expect(failure._tag).toBe("Unauthenticated");

          const saved = yield* post(handler, "/api/learnFeedback", {
            cardId: card.id,
            feedback: "Clear example.",
            token: result.token,
          });

          expect(saved.status).toBe(200);
          expect(yield* bodyText(saved)).toContain('"id"');

          const mcpSaved = yield* mcpRequest(handler, "tools/call", {
            arguments: {
              cardId: card.id,
              feedback: "MCP feedback.",
              token: result.token,
            },
            name: "learnFeedback",
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ToolReply)),
            Effect.orDie
          );

          expect(mcpSaved.result.isError).not.toBe(true);
          expect(
            mcpSaved.result.content.map((part) => part.text).join("\n")
          ).toContain('"id"');

          const mcpDenied = yield* mcpRequest(handler, "tools/call", {
            arguments: {
              cardId: card.id,
              feedback: "Denied feedback.",
              token: "not-a-token",
            },
            name: "learnFeedback",
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ToolReply)),
            Effect.orDie
          );

          expect(mcpDenied.result.isError).toBe(true);
          expect(
            mcpDenied.result.content.map((part) => part.text).join("\n")
          ).toContain("authorizes learnFeedback only");
          expect(
            (yield* post(handler, "/auth/device/token", {
              client_id: "rat-stack-learn-feedback",
              device_code: request.deviceCode,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            })).status
          ).toBe(404);

          return yield* Effect.void;
        }),
      ({ dispose }) => Effect.promise(dispose)
    )
);
