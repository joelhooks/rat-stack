import { Effect, Exit, Layer } from "effect";
import * as McpServer from "effect/ai/McpServer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { ContentStore } from "./content-store.js";

const registerCatalog = Effect.fn("McpContent.registerCatalog")(
  function* registerCatalog(store: ContentStore["Service"]) {
    const catalog = yield* store.catalog;

    for (const resource of catalog.resources) {
      const content = store
        .read(resource.id)
        .pipe(Effect.map((page) => page.text));

      yield* resource.kind === "skill"
        ? McpServer.registerPrompt({
            content: () => content,
            description: resource.description,
            name: resource.name,
          })
        : McpServer.registerResource({
            content,
            description: resource.description,
            mimeType: "text/markdown",
            name: resource.name,
            uri: resource.id,
          });
    }
  }
);

export const mcpContent = Layer.unwrap(
  Effect.gen(function* lazyMcpContent() {
    const store = yield* ContentStore;
    const server = yield* McpServer.McpServer;

    // oxlint-disable-next-line rat-stack-patterns/no-shared-pending-cache -- Existing shared catalog registration awaits asset I/O; packet 1b removes this baseline pending cache.
    const registered = yield* Effect.cachedWithTTL(
      registerCatalog(store).pipe(
        Effect.provideService(McpServer.McpServer, server)
      ),
      (exit) => (Exit.isSuccess(exit) ? "Infinity" : 0)
    );

    return HttpRouter.middleware(
      (httpEffect) =>
        Effect.gen(function* registerOnRequest() {
          const request = yield* HttpServerRequest.HttpServerRequest;

          if (new URL(request.url, "https://ratstack.sh").pathname === "/mcp") {
            yield* registered;
          }

          return yield* httpEffect;
        }).pipe(
          Effect.catchTag("AssetReadError", () =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe(
                {
                  error: { code: -32_603, message: "Content is unavailable" },
                  id: null,
                  jsonrpc: "2.0",
                },
                { headers: { "cache-control": "no-store" }, status: 503 }
              )
            )
          )
        ),
      { global: true }
    );
  })
);
