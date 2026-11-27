import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { instituteStage, withInstitute } from "../src/institute-mount.js";

const fallback = HttpServerResponse.text("Mischief", { status: 404 });

const dispatch = (
  request: Request,
  environment: Parameters<typeof withInstitute>[0]
) =>
  withInstitute(environment)(Effect.succeed(fallback)).pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(request)
    )
  );

it.effect.prop(
  "mounts only the institute segment on the apex, and only with the switch and service",
  {
    arbitraryPath: Schema.String,
    nestedSegment: Schema.String,
  },
  ({ arbitraryPath, nestedSegment }) =>
    Effect.gen(function* testDispatch() {
      for (const [host, path, enabled, hasBinding] of [
        ["ratstack.sh", "/institute", true, true],
        ["ratstack.sh", "/institute/", true, true],
        ["ratstack.sh", "/institute/content/clip.mp3", true, true],
        ["ratstack.sh", `/institute/${nestedSegment}`, true, true],
        ["ratstack.sh", "/institutes", true, true],
        ["ratstack.sh", "/institute-x", true, true],
        ["ratstack.sh", "/lore", true, true],
        ["ratstack.sh", `/${arbitraryPath}`, true, true],
        ["www.ratstack.sh", "/institute", true, true],
        ["other.example.test", "/institute", true, true],
        ["ratstack.sh", "/institute", false, true],
        ["ratstack.sh", "/institute", true, false],
      ] as const) {
        const url = new URL(`https://${host}`);
        url.pathname = path;
        url.searchParams.set("revision", "a/b");

        const request = new Request(url, { headers: { range: "bytes=0-31" } });

        const response = yield* dispatch(request, {
          INSTITUTE: hasBinding
            ? {
                fetch: (forwarded: Request) => {
                  expect(forwarded).toBe(request);

                  return Promise.resolve(
                    new Response("clip", {
                      headers: { "content-range": "bytes 0-31/100" },
                      status: 206,
                    })
                  );
                },
              }
            : undefined,
          INSTITUTE_ENABLED: enabled ? "true" : undefined,
        });

        if (
          enabled &&
          hasBinding &&
          host === "ratstack.sh" &&
          url.pathname.split("/")[1] === "institute"
        ) {
          expect(response.status).toBe(206);
          expect(response.headers["content-range"]).toBe("bytes 0-31/100");
          expect(response.headers["x-robots-tag"]).toBeUndefined();
        } else {
          expect(response).toBe(fallback);
        }
      }
    })
);

it.effect(
  "keeps the stage noindex and passes the same request body to the service",
  () =>
    Effect.gen(function* proveStage() {
      const request = new Request(
        "https://stage.example.test/institute?rev=2",
        {
          body: "payload",
          method: "POST",
        }
      );

      const response = yield* dispatch(request, {
        ALCHEMY_STAGE: instituteStage,
        INSTITUTE: {
          fetch: (forwarded: Request) => {
            expect(forwarded).toBe(request);

            return forwarded.text().then((body) => {
              expect(body).toBe("payload");

              return new Response(null, {
                headers: { location: "/institute/intro" },
                status: 307,
              });
            });
          },
        },
        INSTITUTE_ENABLED: "true",
      });

      expect(response.status).toBe(307);
      expect(response.headers.location).toBe("/institute/intro");
      expect(response.headers["x-robots-tag"]).toBe("noindex");
    })
);
