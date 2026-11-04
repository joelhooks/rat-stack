import { expect, it } from "@effect/vitest";
import {
  Exercise,
  Workshop,
  publishWorkshop,
} from "@rat-stack/core/tokenmaxx-workshop";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";

import { StaticAssets } from "../src/static-assets.js";
import { workshopDirectoryForGeneration } from "../src/workshop-directory.js";
import { workshopRoutes } from "../src/workshop-runtime.js";

it.effect(
  "Workshop MCP serves published exercises from its asset without exposing a draft",
  () =>
    Effect.gen(function* workshopMcpSeam() {
      const generation = "workshop-seam";

      const workshop = yield* Schema.decodeUnknownEffect(Workshop)({
        links: { links: [], never: [], note: "", status: "draft" },
        prep: { items: [], note: "", status: "draft" },
        runs: [],
        starterPublic: false,
      });

      const exercises = yield* Schema.decodeUnknownEffect(
        Schema.Array(Exercise)
      )([
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
      ]);

      const data = publishWorkshop(workshop, exercises);

      const assets = StaticAssets.layer({
        fetch: () => Promise.resolve(Response.json({ data, generation })),
      });

      const { handler, dispose } = HttpRouter.toWebHandler(
        workshopRoutes.pipe(
          Layer.provide(workshopDirectoryForGeneration(generation)),
          Layer.provide(assets)
        )
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      const headers = new Headers({
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      });

      const send = (body: Schema.Json) =>
        Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/tokenmaxx/mcp", {
              body: JSON.stringify(body),
              headers,
              method: "POST",
            }),
            undefined
          )
        );

      const initialized = yield* send({
        id: 0,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "WorkshopTest", version: "1" },
          protocolVersion: "2025-11-25",
        },
      });

      expect(initialized.status).toBe(200);
      yield* Effect.promise(initialized.text.bind(initialized));
      headers.set(
        "mcp-session-id",
        initialized.headers.get("mcp-session-id") ?? ""
      );
      headers.set("mcp-protocol-version", "2025-11-25");

      const notified = yield* send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      expect(notified.status).toBe(202);

      const listed = yield* send({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      });

      const toolList = yield* Effect.promise(listed.text.bind(listed));
      expect(toolList).toContain("listExercises");
      expect(toolList).not.toContain("joinInterest");

      const response = yield* send({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "listExercises" },
      });

      const body = yield* Effect.promise(response.text.bind(response));
      expect(response.status, body).toBe(200);
      expect(body).toContain("Published exercise");
      expect(body).not.toContain("DRAFT_CANARY");
      expect(body).not.toContain("draft-canary");
      expect(body).not.toContain('"isError":true');

      const refused = yield* send({
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { id: "draft-canary" }, name: "readExercise" },
      });

      const refusal = yield* Effect.promise(refused.text.bind(refused));
      expect(refusal).toContain('"isError":true');
      expect(refusal).not.toContain("DRAFT_CANARY");

      const http = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("https://ratstack.sh/tokenmaxx/api/listExercises", {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
          undefined
        )
      );

      const httpBody = yield* Effect.promise(http.text.bind(http));
      expect(http.status, httpBody).toBe(200);
      expect(httpBody).toContain("Published exercise");
      expect(httpBody).not.toContain("DRAFT_CANARY");

      const RpcRequest = Schema.TaggedStruct("Request", {
        headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
        id: Schema.String,
        payload: Schema.Json,
        tag: Schema.String,
      });

      const rpc = yield* Effect.promise(() =>
        handler(
          new Request("https://ratstack.sh/tokenmaxx/rpc", {
            body: JSON.stringify(
              RpcRequest.make({
                headers: [],
                id: "1",
                payload: {},
                tag: "listExercises",
              })
            ),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
      );

      const rpcBody = yield* Effect.promise(rpc.text.bind(rpc));
      expect(rpc.status, rpcBody).toBe(200);
      expect(rpcBody).toContain("Published exercise");
      expect(rpcBody).not.toContain("DRAFT_CANARY");
    })
);
