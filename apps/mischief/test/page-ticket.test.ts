import { expect, it } from "@effect/vitest";
import { IntakeTicket, PAGE_TICKET_SOURCE } from "@rat-stack/core/intake";
import { PAGE_TICKET_PLACEHOLDER } from "@rat-stack/intake-live";
import { Context, Effect, Layer, Option, Ref } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { mischiefRoutes, tokenmaxxResponse } from "../src/app.js";
import {
  SIGNUP_UNAVAILABLE,
  withAvailablePageTicket,
} from "../src/interest/page-ticket.js";
import { generatedTokenmaxxPage } from "./generated-content.js";
import { TestSandbox } from "./test-sandbox.js";

it.effect(
  "tokenmaxx Markdown replaces every page-ticket placeholder with a fresh page ticket",
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

      const response = yield* tokenmaxxResponse;

      expect(response.headers["cache-control"]).toBe("no-store");

      const webResponse = HttpServerResponse.toWeb(response);
      const body = yield* Effect.promise(webResponse.text.bind(webResponse));
      expect(body).not.toContain(PAGE_TICKET_PLACEHOLDER);

      const pageTicket =
        /```text\n(?<ticket>\S+)\n```/u.exec(body)?.groups?.ticket ?? "";

      expect(pageTicket.length).toBeGreaterThan(0);
      expect(body).toContain(`"ticket": "${pageTicket}"`);
      expect(body).toContain(`--ticket '${pageTicket}'`);
      expect((yield* tickets.verify(pageTicket, "served-page")).source).toBe(
        PAGE_TICKET_SOURCE
      );
    }).pipe(Effect.provide(IntakeTicket.testLayer))
);

it.effect(
  "shared route layers remain reachable without crossing entrypoints",
  () =>
    Effect.gen(function* isolatedEntrypoints() {
      const memoMap = yield* Layer.makeMemoMap;

      const shared = mischiefRoutes().pipe(
        Layer.provide(TestSandbox),
        Layer.provide(IntakeTicket.testLayer)
      );

      const first = yield* HttpRouter.toHttpEffect(
        Layer.merge(
          shared,
          HttpRouter.add("GET", "/first-only", HttpServerResponse.text("first"))
        )
      ).pipe(Effect.provideService(Layer.CurrentMemoMap, memoMap));

      const second = yield* HttpRouter.toHttpEffect(
        Layer.merge(
          shared,
          HttpRouter.add(
            "GET",
            "/second-only",
            HttpServerResponse.text("second")
          )
        )
      ).pipe(Effect.provideService(Layer.CurrentMemoMap, memoMap));

      for (const [entrypoint, own, other] of [
        [first, "/first-only", "/second-only"],
        [second, "/second-only", "/first-only"],
      ] as const) {
        for (const [path, status] of [
          [own, 200],
          [other, 404],
          ["/llms.txt", 200],
          ["/tokenmaxx", 200],
        ] as const) {
          const response = yield* entrypoint.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(new Request(`http://localhost${path}`))
            )
          );

          expect(response.status, path).toBe(status);
        }
      }
    })
);

it.effect(
  "agent Markdown mints exactly one ticket per request and the reader page carries none",
  () =>
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
        mischiefRoutes().pipe(
          Layer.provide(TestSandbox),
          Layer.provide(counted)
        )
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      for (const expected of [1, 2]) {
        const response = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/tokenmaxx", {
              headers: { accept: "text/markdown" },
            }),
            Context.empty()
          )
        );

        expect(response.status).toBe(200);
        expect(yield* Ref.get(mints)).toBe(expected);
      }

      expect(generatedTokenmaxxPage).not.toContain(PAGE_TICKET_PLACEHOLDER);
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

    const html = generatedTokenmaxxPage;
    expect(html).not.toContain(ticket);
    expect(html).not.toContain(PAGE_TICKET_PLACEHOLDER);
    expect(html).not.toContain("The page ticket is:");
    expect(html).not.toContain('"ticket":');
  }).pipe(Effect.scoped)
);

it.effect(
  "unavailable minting removes the submit section from agent Markdown only",
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
        expect(response.status).toBe(200);

        for (const view of [body, generatedTokenmaxxPage]) {
          expect(view).not.toContain(PAGE_TICKET_PLACEHOLDER);
          expect(view).not.toContain('"ticket":');
          expect(view).not.toContain("--ticket");
          expect(view).not.toContain("The page ticket is:");
        }

        expect(body).toContain(SIGNUP_UNAVAILABLE);
        expect(body).toContain("What are you building?");
        expect(generatedTokenmaxxPage).not.toContain(SIGNUP_UNAVAILABLE);
        expect(generatedTokenmaxxPage).not.toContain("What are you building?");
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
