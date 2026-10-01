import { expect, it } from "@effect/vitest";
import { IntakeTicket, PAGE_TICKET_SOURCE } from "@rat-stack/core/intake";
import { PAGE_TICKET_PLACEHOLDER } from "@rat-stack/intake-live";
import { Context, Effect, Layer, Option } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { mischiefRoutes, tokenmaxxResponse } from "../src/app.js";
import { withAvailablePageTicket } from "../src/interest/page-ticket.js";
import { TestSandbox } from "./test-sandbox.js";

it.effect(
  "HTML and markdown replace every page-ticket placeholder with a fresh page ticket",
  () =>
    Effect.gen(function* freshTickets() {
      const tickets = yield* IntakeTicket;
      const fixture = `ticket=${PAGE_TICKET_PLACEHOLDER};again=${PAGE_TICKET_PLACEHOLDER}`;
      const first = yield* withAvailablePageTicket(fixture);
      const second = yield* withAvailablePageTicket(fixture);
      expect(first).not.toContain(PAGE_TICKET_PLACEHOLDER);
      expect(second).not.toContain(PAGE_TICKET_PLACEHOLDER);
      expect(first).not.toBe(second);
      const firstTicket = first.slice("ticket=".length).split(";")[0] ?? "";
      expect(first).toBe(`ticket=${firstTicket};again=${firstTicket}`);
      expect((yield* tickets.verify(firstTicket, "submission-1")).source).toBe(
        PAGE_TICKET_SOURCE
      );

      for (const accept of ["text/html", "text/markdown"]) {
        const response = yield* tokenmaxxResponse(
          HttpServerRequest.fromWeb(
            new Request("https://ratstack.sh/tokenmaxx", {
              headers: { accept },
            })
          )
        );

        expect(response.headers["cache-control"]).toBe("no-store");

        const webResponse = HttpServerResponse.toWeb(response);
        const body = yield* Effect.promise(webResponse.text.bind(webResponse));
        expect(body).not.toContain(PAGE_TICKET_PLACEHOLDER);

        if (accept === "text/markdown") {
          const pageTicket =
            /```text\n(?<ticket>\S+)\n```/u.exec(body)?.groups?.ticket ?? "";

          expect(pageTicket.length).toBeGreaterThan(0);
          expect(body).toContain(`"ticket": "${pageTicket}"`);
          expect(body).toContain(`--ticket '${pageTicket}'`);
          expect(
            (yield* tickets.verify(pageTicket, "served-page")).source
          ).toBe(PAGE_TICKET_SOURCE);
        }
      }
    }).pipe(Effect.provide(IntakeTicket.testLayer))
);

it.effect("the cache layer cannot read or write the tokenmaxx page", () =>
  Effect.gen(function* neverCacheTickets() {
    let reads = 0;
    let writes = 0;

    const routes = mischiefRoutes({
      staticCache: {
        // oxlint-disable-next-line typescript/promise-function-async -- This fake matches the native Cache API Promise boundary.
        match: () => {
          reads += 1;

          return Promise.resolve(
            Option.getOrUndefined(Option.none<Response>())
          );
        },
        // oxlint-disable-next-line typescript/promise-function-async -- This fake matches the native Cache API Promise boundary.
        put: () => {
          writes += 1;

          return Promise.resolve();
        },
      },
    }).pipe(Layer.provide(TestSandbox));

    const { handler, dispose } = HttpRouter.toWebHandler(routes);
    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    for (const accept of ["text/html", "text/markdown"]) {
      const response = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("https://ratstack.sh/tokenmaxx", { headers: { accept } }),
          Context.empty()
        )
      );

      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    expect(reads).toBe(0);
    expect(writes).toBe(0);
    expect(yield* withAvailablePageTicket(PAGE_TICKET_PLACEHOLDER)).toBe("");
  }).pipe(Effect.scoped)
);
