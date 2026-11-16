import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import tube from "../../../.brain/data/tube.json" with { type: "json" };
import { withReaderWebsite } from "../src/reader-website.js";
import { isTubeVideoPath, tubeRedirectPath } from "../src/tube-routes.js";
import { catalog } from "./generated-content.js";

const handler = withReaderWebsite(
  {
    fetch: (request: Request) =>
      Promise.resolve(
        new Response("page", {
          status: catalog.pageRoutes.includes(new URL(request.url).pathname)
            ? 200
            : 404,
        })
      ),
  },
  (_path, response) => Effect.succeed(response)
)(Effect.succeed(HttpServerResponse.empty({ status: 404 })));

const request = (path: string, accept = "text/html") =>
  handler.pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(
        new Request(`https://ratstack.sh${path}`, { headers: { accept } })
      )
    )
  );

it.effect.prop(
  "each published id redirects permanently to its existing slug and preserves every query byte for readers and agents",
  {
    query: Schema.String,
    accept: Schema.Literals(["text/html", "text/markdown", "*/*"]),
  },
  ({ query, accept }) =>
    Effect.gen(function* redirectsResolve() {
      const search = `?${new URLSearchParams({ q: query }).toString()}&t=23&x=1&x=2&raw=%2f%20&plus=+`;

      for (const video of tube.videos) {
        const response = yield* request(`/tube/${video.id}${search}`, accept);
        const published = "page" in video;
        expect(response.status).toBe(published ? 301 : 404);
        expect(response.headers.location).toBe(
          published ? `/tube/${video.slug}${search}` : undefined
        );
        const destination = yield* request(`/tube/${video.slug}`);
        expect(destination.status).toBe(published ? 200 : 404);
      }
    })
);

it.prop(
  "redirect existence follows page publication from the same record as slug routing",
  { published: Schema.Boolean },
  ({ published }) => {
    const base = { id: "AAAAAAAAAAA", slug: "a-readable-video-title" };
    const video = published ? { ...base, page: {} } : base;
    expect(isTubeVideoPath(`/tube/${video.slug}`, [video])).toBe(published);
    expect(tubeRedirectPath(`/tube/${video.id}`, [video])).toBe(
      published ? `/tube/${video.slug}` : undefined
    );
  }
);

it.effect("unknown ids, unknown slugs and unpublished paths remain 404", () =>
  Effect.gen(function* unknownPaths() {
    for (const path of [
      "/tube/AAAAAAAAAAA",
      "/tube/not-a-known-video-slug",
      "/tube/",
      "/tube/sam-goodwin-alchemy-effect-ai/extra",
    ]) {
      const response = yield* request(path);
      expect(response.status).toBe(404);
      expect(response.headers.location).toBeUndefined();
    }
  })
);
