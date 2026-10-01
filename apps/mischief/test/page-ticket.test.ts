import { expect, it } from "@effect/vitest";
import { IntakeTicket, PAGE_TICKET_SOURCE } from "@rat-stack/core/intake";
import { PAGE_TICKET_PLACEHOLDER } from "@rat-stack/intake-live";
import { Context, Effect, Layer, Option, Ref } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { mischiefRoutes, tokenmaxxResponse } from "../src/app.js";
import {
  SIGNUP_UNAVAILABLE,
  withAvailablePageTicket,
} from "../src/interest/page-ticket.js";
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

it.effect("HTML mints no ticket and agent Markdown mints exactly one", () =>
  Effect.gen(function* countViewTickets() {
    const tickets = yield* IntakeTicket;
    const mints = yield* Ref.make(0);

    const counted = Layer.succeed(IntakeTicket, {
      mint: (source) =>
        tickets
          .mint(source)
          .pipe(Effect.tap(() => Ref.update(mints, (count) => count + 1))),
      verify: tickets.verify,
    });

    const { handler, dispose } = HttpRouter.toWebHandler(
      mischiefRoutes().pipe(Layer.provide(TestSandbox), Layer.provide(counted))
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    for (const accept of ["text/html", "text/markdown"]) {
      const response = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("https://ratstack.sh/tokenmaxx", { headers: { accept } }),
          Context.empty()
        )
      );

      expect(response.status).toBe(200);
      expect(yield* Ref.get(mints)).toBe(accept === "text/html" ? 0 : 1);
    }
  }).pipe(Effect.scoped, Effect.provide(IntakeTicket.testLayer))
);

it.effect("worker-built routes retain the ticket service for requests", () =>
  Effect.gen(function* workerTicketContext() {
    const joinServices = yield* Layer.build(IntakeTicket.testLayer);

    const tickets = yield* IntakeTicket.pipe(
      Effect.provideContext(joinServices)
    );

    const routes = mischiefRoutes().pipe(
      Layer.provide(TestSandbox),
      Layer.provide(Layer.succeedContext(joinServices))
    );

    const { handler, dispose } = HttpRouter.toWebHandler(routes);
    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const response = yield* Effect.promise(
      handler.bind(
        undefined,
        new Request("https://ratstack.sh/tokenmaxx", {
          headers: { accept: "text/markdown" },
        }),
        Context.empty()
      )
    );

    const body = yield* Effect.promise(response.text.bind(response));

    const ticket =
      /```text\n(?<ticket>\S+)\n```/u.exec(body)?.groups?.ticket ?? "";

    expect(ticket.length).toBeGreaterThan(0);
    expect(body).not.toContain(PAGE_TICKET_PLACEHOLDER);
    expect(body).toContain(`"ticket": "${ticket}"`);
    expect(body).toContain(`--ticket '${ticket}'`);
    expect((yield* tickets.verify(ticket, "worker-request")).source).toBe(
      PAGE_TICKET_SOURCE
    );

    const htmlResponse = yield* Effect.promise(
      handler.bind(
        undefined,
        new Request("https://ratstack.sh/tokenmaxx", {
          headers: { accept: "text/html" },
        }),
        Context.empty()
      )
    );

    const html = yield* Effect.promise(htmlResponse.text.bind(htmlResponse));
    expect(html).not.toContain(ticket);
    expect(html).not.toContain(PAGE_TICKET_PLACEHOLDER);
    expect(html).not.toContain("The page ticket is:");
    expect(html).not.toContain('"ticket":');
  }).pipe(Effect.scoped)
);

it.effect(
  "unavailable minting removes the submit section without affecting HTML",
  () =>
    Effect.gen(function* unavailableTickets() {
      const tickets = yield* IntakeTicket;

      for (const mode of ["absent", "mint-fails", "empty"] as const) {
        const joinServices = yield* Layer.build(
          mode === "absent"
            ? Layer.empty
            : Layer.succeed(IntakeTicket, {
                mint: () =>
                  mode === "empty"
                    ? Effect.succeed("")
                    : Effect.die("ticket mint unavailable"),
                verify: tickets.verify,
              })
        );

        const routes = mischiefRoutes().pipe(
          Layer.provide(TestSandbox),
          Layer.provide(Layer.succeedContext(joinServices))
        );

        const { handler, dispose } = HttpRouter.toWebHandler(routes);
        yield* Effect.addFinalizer(() => Effect.promise(dispose));

        for (const accept of ["text/markdown", "text/html"]) {
          const response = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request("https://ratstack.sh/tokenmaxx", {
                headers: { accept },
              }),
              Context.empty()
            )
          );

          const body = yield* Effect.promise(response.text.bind(response));
          expect(response.status).toBe(200);
          expect(body).not.toContain(PAGE_TICKET_PLACEHOLDER);
          expect(body).not.toContain('"ticket":');
          expect(body).not.toContain("--ticket");
          expect(body).not.toContain("The page ticket is:");

          if (accept === "text/markdown") {
            expect(body).toContain(SIGNUP_UNAVAILABLE);
            expect(body).toContain("What are you building?");
          } else {
            expect(body).not.toContain(SIGNUP_UNAVAILABLE);
            expect(body).not.toContain("What are you building?");
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(IntakeTicket.testLayer))
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
    expect(yield* withAvailablePageTicket(PAGE_TICKET_PLACEHOLDER)).toBe(
      SIGNUP_UNAVAILABLE
    );
  }).pipe(Effect.scoped)
);
