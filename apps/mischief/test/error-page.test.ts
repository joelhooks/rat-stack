import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { expect } from "vitest";

import { errorPages, mischiefRoutes } from "../src/app.js";
import { renderErrorPage } from "../src/error-page.js";
import { TestSandbox } from "./test-sandbox.js";

it("escapes an XSS path in the shared error document", () => {
  const path = '/<script>alert("x")</script>';

  const html = renderErrorPage(
    {
      code: 404,
      message: "That bin got pulled out.",
      path,
      title: "Not found",
    },
    "https://ratstack.sh",
    true
  );

  expect(html).toContain("/&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("<header>");
  expect(html).toContain("<footer>");
  expect(html).toContain("<style>");
  expect(html).not.toContain('class="house-ad"');
  expect(html).not.toContain("<ol>");
});

it.effect("serves a framed 404 and next actions in both representations", () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        mischiefRoutes().pipe(Layer.provide(TestSandbox)),
        { disableLogger: true }
      )
    ),
    ({ handler }) =>
      Effect.gen(function* checkNotFound() {
        for (const accept of ["text/html", "text/markdown"]) {
          const response = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request("https://ratstack.sh/nope-xyz", {
                headers: { accept },
              }),
              undefined
            )
          );

          const body = yield* Effect.promise(response.text.bind(response));
          expect(response.status).toBe(404);
          expect(body).toContain("/nope-xyz");
          expect(body).not.toContain("<ol></ol>");

          for (const path of [
            "/glossary",
            "/lore",
            "/systems",
            "/log",
            "/llms.txt",
          ]) {
            expect(body).toContain(path);
          }

          if (accept === "text/html") {
            expect(body).toContain('class="error-code">404</span>');
            expect(body).toContain("<header>");
            expect(body).toContain("<footer>");
            expect(body).not.toContain('class="house-ad"');
          } else {
            expect(body.startsWith("# 404 Not found")).toBe(true);
            expect(body).toContain("- [Home](/)");
          }
        }

        const response = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/api/nope-xyz", {
              headers: { accept: "application/json" },
            }),
            undefined
          )
        );

        expect(response.status).toBe(404);
        expect(yield* Effect.promise(response.text.bind(response))).toBe(
          "Not found.\n"
        );
      }),
    ({ dispose }) => Effect.promise(dispose)
  )
);

it.effect(
  "frames server failures without changing JSON or problem responses",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          Layer.mergeAll(
            errorPages,
            HttpRouter.add(
              "GET",
              "/broken",
              Effect.die("private failure details")
            ),
            HttpRouter.add(
              "GET",
              "/failed",
              HttpServerResponse.text("private failure details", {
                status: 500,
              })
            ),
            HttpRouter.add(
              "GET",
              "/json",
              HttpServerResponse.text('{"error":"unchanged"}', {
                contentType: "application/json",
                status: 500,
              })
            ),
            HttpRouter.add(
              "GET",
              "/problem",
              HttpServerResponse.text('{"status":500}', {
                contentType: "application/problem+json",
                status: 500,
              })
            )
          ),
          { disableLogger: true }
        )
      ),
      ({ handler }) =>
        Effect.gen(function* checkFailures() {
          for (const path of ["/broken", "/failed"]) {
            const response = yield* Effect.promise(
              handler.bind(
                undefined,
                new Request(`https://ratstack.sh${path}`, {
                  headers: { accept: "text/html" },
                }),
                undefined
              )
            );

            const body = yield* Effect.promise(response.text.bind(response));
            expect(response.status).toBe(500);
            expect(body).toContain('class="error-code">500</span>');
            expect(body).toContain("Internal server error");
            expect(body).toContain(path);
            expect(body).toContain("<header>");
            expect(body).toContain("<footer>");
            expect(body).not.toContain("private failure details");
            expect(body).not.toContain('class="house-ad"');
          }

          for (const [path, expected] of [
            ["/json", '{"error":"unchanged"}'],
            ["/problem", '{"status":500}'],
          ]) {
            const response = yield* Effect.promise(
              handler.bind(
                undefined,
                new Request(`https://ratstack.sh${path}`, {
                  headers: { accept: "text/html" },
                }),
                undefined
              )
            );

            expect(response.status).toBe(500);
            expect(yield* Effect.promise(response.text.bind(response))).toBe(
              expected
            );
          }
        }),
      ({ dispose }) => Effect.promise(dispose)
    )
);
