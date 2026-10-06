import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { websiteHandler } from "../src/server/handler.js";

it.effect.prop(
  "marks every preview response noindex without changing status or body",
  {
    path: Schema.Literals([
      "/rpc",
      "/rpc/read",
      "/__rat",
      "/__rat/rpc",
      "/",
      "/read",
    ]),
    pr: Schema.Int.check(Schema.isGreaterThan(0)),
    sha: Arbitrary.schema(
      Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u))
    ),
  },
  ({ sha, path, pr }) =>
    Effect.gen(function* previewHeaders() {
      const handler = websiteHandler(
        // @effect-diagnostics-next-line asyncFunction:off -- This test double mirrors the Worker binding Promise boundary.
        async () => await Promise.resolve(new Response("rpc", { status: 201 })),
        // @effect-diagnostics-next-line asyncFunction:off -- This test double mirrors the asset binding Promise boundary.
        async () =>
          await Promise.resolve(new Response("asset", { status: 202 })),
        sha
      );

      const response = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- The handler returns a host Promise.
        async () =>
          await handler(new Request(`https://pr-${pr}.ratstack.sh${path}`))
      );

      expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(response.headers.get("X-Preview-Commit")).toBe(sha);

      const body = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- Response.text is a host Promise.
        async () => await response.text()
      );

      if (path.startsWith("/__rat")) {
        expect(response.status).toBe(404);
        expect(body).toBe("Not found");
      } else if (path.startsWith("/rpc")) {
        expect(response.status).toBe(201);
        expect(body).toBe("rpc");
      } else {
        expect(response.status).toBe(202);
        expect(body).toBe("asset");
      }
    })
);

it.effect.prop(
  "routes RPC to its binding, blocks private inspector paths, and serves other assets",
  {
    family: Arbitrary.schema(Schema.Literals(["rpc", "private", "assets"])),
    suffix: Arbitrary.schema(Schema.String),
  },
  ({ family, suffix }) =>
    Effect.gen(function* checkWorkerRouting() {
      const forwarded: Request[] = [];
      const assets: Request[] = [];
      const rpcResponse = new Response("rpc");
      const assetResponse = new Response("asset");

      const handler = websiteHandler(
        // @effect-diagnostics-next-line asyncFunction:off -- The binding double has the same Promise host contract as Cloudflare.
        async (request) => {
          forwarded.push(request);

          return await Promise.resolve(rpcResponse);
        },
        // @effect-diagnostics-next-line asyncFunction:off -- The asset binding double mirrors its Promise host contract.
        async (request) => {
          assets.push(request);

          return await Promise.resolve(assetResponse);
        }
      );

      const prefixes = {
        assets: "/read",
        private: "/__rat",
        rpc: "/rpc",
      } as const;

      const segment = new URLSearchParams({ value: suffix })
        .toString()
        .slice("value=".length);

      const pathname = `${prefixes[family]}${suffix.length === 0 ? "" : `/${segment}`}`;

      const request = new Request(
        `https://example.test${pathname}?query=kept`,
        { body: "kept body", headers: { "x-proof": "kept" }, method: "POST" }
      );

      const response = yield* Effect.promise(handler.bind(undefined, request));

      if (family === "rpc") {
        expect(response).toBe(rpcResponse);
        expect(forwarded).toEqual([request]);
        expect(assets).toEqual([]);
      } else if (family === "private") {
        expect(response.status).toBe(404);
        expect(forwarded).toEqual([]);
        expect(assets).toEqual([]);
      } else {
        expect(response).toBe(assetResponse);
        expect(forwarded).toEqual([]);
        expect(assets).toEqual([request]);
      }
    })
);
