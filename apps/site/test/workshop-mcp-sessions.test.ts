import { expect, it } from "@effect/vitest";
import {
  Exercise,
  publishWorkshop,
  Workshop,
} from "@rat-stack/core/tokenmaxx-workshop";
import { WorkshopDirectory } from "@rat-stack/core/workshop-directory";
import { Arbitrary, Effect, Layer, Match, Schema, Scope } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { openLegacySession } from "../src/legacy-mcp/session.js";
import type { StoredSession } from "../src/legacy-mcp/session.js";
import { workshopMcpForward } from "../src/workshop-mcp-loader.js";
import type { workshopRoutes } from "../src/workshop-runtime.js";
import { workshopRoutesFor } from "../src/workshop-runtime.js";

const directory = Layer.effect(
  WorkshopDirectory,
  Effect.gen(function* testDirectory() {
    const workshop = yield* Schema.decodeUnknownEffect(Workshop)({
      links: { links: [], never: [], note: "DRAFT_CANARY", status: "draft" },
      prep: { items: [], note: "DRAFT_CANARY", status: "draft" },
      runs: [],
      starterPublic: false,
    });

    const exercises = yield* Schema.decodeUnknownEffect(Schema.Array(Exercise))(
      [
        {
          body: "Published explanation",
          id: "live",
          section: "awakes",
          status: "published",
          title: "Published exercise",
        },
        {
          body: "DRAFT_CANARY",
          id: "draft-canary",
          section: "awakes",
          status: "draft",
          title: "DRAFT_CANARY",
        },
      ]
    );

    return WorkshopDirectory.of({
      data: Effect.succeed(publishWorkshop(workshop, exercises)),
    });
  })
);

const freshRuntime = (routes: typeof workshopRoutes) =>
  Effect.gen(function* makeFreshRuntime() {
    const runtime = HttpRouter.toWebHandler(
      routes.pipe(Layer.provide(directory)),
      { disableLogger: true }
    );

    yield* Effect.addFinalizer(() => Effect.promise(runtime.dispose));

    return (request: Request) => Effect.promise(() => runtime.handler(request));
  });

const request = (
  body: Readonly<Record<string, Schema.Json>>,
  session?: string
) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });

  if (session !== undefined) {
    headers.set("mcp-protocol-version", "2025-11-25");
    headers.set("mcp-session-id", session);
  }

  return new Request("https://ratstack.sh/tokenmaxx/mcp", {
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    headers,
    method: "POST",
  });
};

const tools = [
  "listExercises",
  "readExercise",
  "currentExercise",
  "workshopSchedule",
  "workshopPrep",
  "workshopLinks",
] as const;

const toolParams = (name: string) => ({
  arguments: Match.value(name).pipe(
    Match.when("readExercise", () => ({ id: "live" })),
    Match.when("currentExercise", () => ({ run: "2026-11-17" })),
    Match.orElse(() => ({}))
  ),
  name,
});

it.effect.prop(
  "a Workshop client keeps its session across fresh isolates and object evictions",
  {
    calls: Arbitrary.schema(
      Schema.Array(
        Schema.Literals([
          "tools/list",
          "listExercises",
          "workshopSchedule",
          "workshopPrep",
          "workshopLinks",
          "readExercise",
          "currentExercise",
        ])
      ).check(Schema.isMinLength(1), Schema.isMaxLength(12))
    ),
  },
  ({ calls }) =>
    Effect.gen(function* crossIsolateHistory() {
      const scope = yield* Effect.scope;
      const stored = new Map<string, StoredSession>();

      const router = {
        forward: (id: string, incoming: Request) =>
          Effect.gen(function* forwardToFreshObject() {
            const forward = yield* workshopMcpForward.pipe(
              Effect.provide(directory),
              Effect.orDie
            );

            const object = yield* openLegacySession({
              forward,
              storage: {
                load: Effect.sync(() => stored.get(id)),
                save: (value) =>
                  Effect.sync(() => {
                    stored.set(id, value);
                  }),
              },
            });

            return yield* object.handle(incoming, id);
          }).pipe(Scope.provide(scope)),
      };

      const routes = workshopRoutesFor(router);
      const first = yield* freshRuntime(routes);

      const initialized = yield* first(
        request({
          id: 0,
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: { name: "WorkshopTest", version: "1" },
            protocolVersion: "2025-11-25",
          },
        })
      );

      expect(initialized.status).toBe(200);
      const id = initialized.headers.get("mcp-session-id") ?? "";
      expect(id).not.toBe("");
      yield* Effect.promise(() => initialized.text());
      const following = yield* freshRuntime(routes);

      const notified = yield* following(
        request({ method: "notifications/initialized" }, id)
      );

      expect(notified.status).toBe(202);

      for (const [index, call] of [
        "tools/list",
        ...tools,
        ...calls,
      ].entries()) {
        const send = yield* freshRuntime(routes);

        const response = yield* send(
          request(
            {
              id: index + 1,
              method: call === "tools/list" ? call : "tools/call",
              params: call === "tools/list" ? {} : toolParams(call),
            },
            id
          )
        );

        const text = yield* Effect.promise(() => response.text());
        expect(response.status, text).toBe(200);
        expect(text).not.toContain('"isError":true');
        expect(text).not.toContain("DRAFT_CANARY");
      }

      for (const [index, name] of tools.entries()) {
        const send = yield* freshRuntime(routes);

        const modern = request({
          id: index,
          method: "tools/call",
          params: {
            ...toolParams(name),
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "WorkshopTest",
                version: "1",
              },
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            },
          },
        });

        modern.headers.set("mcp-protocol-version", "2026-07-28");
        modern.headers.set("mcp-method", "tools/call");
        modern.headers.set("mcp-name", name);
        const response = yield* send(modern);
        const text = yield* Effect.promise(() => response.text());
        expect(response.status, text).toBe(200);
        expect(response.headers.has("mcp-session-id")).toBe(false);
        expect(text).not.toContain('"isError":true');
        expect(text).not.toContain("DRAFT_CANARY");
      }

      const send = yield* freshRuntime(routes);

      const draft = yield* send(
        request(
          {
            id: "draft",
            method: "tools/call",
            params: { arguments: { id: "draft-canary" }, name: "readExercise" },
          },
          id
        )
      );

      const refusal = yield* Effect.promise(() => draft.text());
      expect(draft.status).toBe(200);
      expect(refusal).toContain('"isError":true');
      expect(refusal).not.toContain("DRAFT_CANARY");
      expect(stored.size).toBe(1);
    })
);
