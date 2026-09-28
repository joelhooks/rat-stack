import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Etag, HttpPlatform, HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiTest } from "effect/unstable/httpapi";

import { defineContract, implement, toHttpApi } from "../src/index.js";
import { Authenticated, AuthenticatedLayer, Caller } from "./authenticated.js";
import { NotFound, echo } from "./fixtures.js";
import { Maintenance, MaintenanceLayer } from "./maintenance.js";
import { ProblemBodies, ProblemBodiesLayer } from "./problem-bodies.js";
import {
  Problem,
  ProblemStatus,
  ProblemStatusLayer,
} from "./problem-status.js";

const TestServices = Layer.mergeAll(
  Path.layer,
  Etag.layerWeak,
  HttpPlatform.layer
).pipe(Layer.provideMerge(FileSystem.layerNoop({})));

const lookupContract = defineContract("lookup", {
  description: "Read one item with an optional window",
  failure: NotFound,
  http: { method: "GET", path: "/items/:item" },
  input: Schema.Struct({
    item: Schema.String,
    window: Schema.optional(Schema.Finite),
  }),
  output: Schema.Struct({ item: Schema.String, window: Schema.Finite }),
});

const lookup = implement(lookupContract, ({ item, window }) =>
  item === "nobody"
    ? Effect.fail(new NotFound({ name: item }))
    : Effect.succeed({ item, window: window ?? 60 })
);

const renameContract = defineContract("rename", {
  description: "Rename one item",
  failure: Schema.Never,
  http: { method: "PUT", path: "/items/:item/name" },
  input: Schema.Struct({ item: Schema.String, name: Schema.String }).check(
    Schema.makeFilter(({ item, name }) => item !== name)
  ),
  output: Schema.Struct({ item: Schema.String, name: Schema.String }),
});

const rename = implement(renameContract, (input) => Effect.succeed(input));

const lenientContract = defineContract("lenient", {
  description: "Read a minutes knob that falls back instead of refusing",
  failure: Schema.Never,
  http: { method: "GET", path: "/lenient" },
  input: Schema.Struct({ minutes: Schema.optional(Schema.String) }),
  output: Schema.Struct({ minutes: Schema.Finite }),
});

const lenient = implement(lenientContract, ({ minutes }) => {
  const parsed = Number(minutes);

  return Effect.succeed({
    minutes: Number.isFinite(parsed) && parsed > 0 ? parsed : 60,
  });
});

const routes = toHttpApi("RoutesApi", [lookup, rename, lenient, echo]);

const serve = (
  app: Layer.Layer<
    never,
    never,
    | Etag.Generator
    | FileSystem.FileSystem
    | HttpPlatform.HttpPlatform
    | HttpRouter.HttpRouter
    | Path.Path
  >
) =>
  Effect.gen(function* served() {
    const { dispose, handler } = HttpRouter.toWebHandler(
      app.pipe(Layer.provide(TestServices)),
      { disableLogger: true }
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    return handler;
  });

const decodeJsonText = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

const fetchJson = (
  handler: (request: Request) => Promise<Response>,
  request: Request
) =>
  Effect.gen(function* fetched() {
    // oxlint-disable-next-line typescript/promise-function-async -- HttpRouter exposes a Promise API for this in-memory web handler test.
    const response = yield* Effect.promise(() => handler(request));

    // oxlint-disable-next-line typescript/promise-function-async -- Web Response.text returns a Promise at this in-memory transport boundary.
    const text = yield* Effect.promise(() => response.text());

    return {
      body: text === "" ? undefined : yield* Effect.orDie(decodeJsonText(text)),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  });

const at = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost${path}`, init);

describe("toHttpApi routes", () => {
  it.layer(TestServices)("over an in-process client", (test) => {
    test.effect("serves a contract at its own method, path and query", () =>
      Effect.gen(function* routed() {
        const client = yield* HttpApiTest.groups(routes.api, [
          "capabilities",
        ]).pipe(Effect.provide(routes.layer));

        const read = yield* client.capabilities.lookup({
          params: { item: "a" },
          query: { window: 5 },
        });

        const renamed = yield* client.capabilities.rename({
          params: { item: "a" },
          payload: { name: "b" },
        });

        const echoed = yield* client.capabilities.echo({
          payload: { text: "ab", times: 2 },
        });

        expect([read, renamed, echoed]).toEqual([
          { item: "a", window: 5 },
          { item: "a", name: "b" },
          { text: "abab" },
        ]);
      })
    );
  });

  it("documents path parameters, the query, and the body where each route reads them", () => {
    const { paths } = routes.openApi();
    const read = paths["/items/{item}"]?.get;
    const renamed = paths["/items/{item}/name"]?.put;

    expect({
      echo: paths["/echo"]?.post?.requestBody !== undefined,
      read: read?.parameters.map(({ in: where, name }) => `${where}:${name}`),
      readBody: read?.requestBody,
      renamed: renamed?.parameters.map(
        ({ in: where, name }) => `${where}:${name}`
      ),
      renamedBody:
        renamed?.requestBody?.content["application/json"]?.schema.required,
    }).toEqual({
      echo: true,
      read: ["path:item", "query:window"],
      readBody: undefined,
      renamed: ["path:item"],
      renamedBody: ["name"],
    });
  });

  it("refuses a path parameter that is not an input field, at compile time and at projection", () => {
    // @ts-expect-error -- a path parameter must name an input field; this call proves the type check, and toHttpApi's throw covers contracts only known as AnyContract.
    const strayContract = defineContract("stray", {
      description: "Name a parameter the input lacks",
      failure: Schema.Never,
      http: { method: "GET", path: "/stray/:missing" },
      input: Schema.Struct({ item: Schema.String }),
      output: Schema.String,
    });

    const stray = implement(strayContract, ({ item }) => Effect.succeed(item));

    expect(() => toHttpApi("StrayApi", [stray])).toThrow(":missing");
  });

  it.effect("keeps the input's own checks across path and body", () =>
    Effect.gen(function* checked() {
      const handler = yield* serve(
        HttpApiBuilder.layer(routes.api).pipe(Layer.provide(routes.layer))
      );

      const same = yield* fetchJson(
        handler,
        at("/items/a/name", {
          body: JSON.stringify({ name: "a" }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        })
      );

      expect(same.status).toBe(400);
    }).pipe(Effect.scoped)
  );

  it.effect(
    "answers a lenient query with the handler's fallback, never a decode refusal",
    () =>
      Effect.gen(function* fallback() {
        const handler = yield* serve(
          HttpApiBuilder.layer(routes.api).pipe(Layer.provide(routes.layer))
        );

        const bad = yield* fetchJson(handler, at("/lenient?minutes=abc"));
        const good = yield* fetchJson(handler, at("/lenient?minutes=5"));

        expect([bad.status, bad.body, good.body]).toEqual([
          200,
          { minutes: 60 },
          { minutes: 5 },
        ]);
      }).pipe(Effect.scoped)
  );
});

const whoAmIContract = defineContract("whoAmI", {
  description: "Name the caller the host authenticated",
  failure: Schema.Never,
  http: { method: "GET", path: "/me" },
  input: Schema.Struct({}),
  output: Schema.Struct({ name: Schema.String }),
});

const whoAmI = implement(whoAmIContract, () =>
  Caller.use((caller) => Effect.succeed({ name: caller.name }))
);

const gateContract = defineContract("gate", {
  description: "Refuse with a problem whose status is its own",
  failure: Problem,
  http: { method: "GET", path: "/gate/:status" },
  input: Schema.Struct({
    mode: Schema.optional(Schema.Literals(["leak", "undeclared"])),
    status: Schema.Finite,
  }),
  output: Schema.String,
});

const undeclaredFailure: Partial<typeof Problem.Type> & {
  readonly secret: string;
} = { secret: "hunter2", status: 409 };

const gate = implement(gateContract, ({ mode, status }) => {
  if (mode === "undeclared") {
    // SAFETY: this handler breaks its contract on purpose, failing with a value its failure schema refuses, to show that a problem renderer lets it fail closed.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Effect.fail(undeclaredFailure as typeof Problem.Type);
  }

  const refusal = { status, title: "Refused" };

  return Effect.fail(
    mode === "leak" ? { ...refusal, secret: "hunter2" } : refusal
  );
});

describe("toHttpApi middleware", () => {
  const guarded = toHttpApi("GuardedApi", [whoAmI, lookup], {
    middleware: [Authenticated],
  });

  it.effect(
    "runs host middleware before every handler and provides what it names",
    () =>
      Effect.gen(function* middleware() {
        const handler = yield* serve(
          HttpApiBuilder.layer(guarded.api).pipe(
            Layer.provide(guarded.layer.pipe(Layer.provide(AuthenticatedLayer)))
          )
        );

        const signedIn = yield* fetchJson(
          handler,
          at("/me", { headers: { "x-caller": "rat" } })
        );

        const anonymous = yield* fetchJson(handler, at("/me"));
        const anonymousLookup = yield* fetchJson(handler, at("/items/a"));

        expect([
          signedIn.status,
          signedIn.body,
          anonymous.status,
          anonymousLookup.status,
        ]).toEqual([200, { name: "rat" }, 401, 401]);
      }).pipe(Effect.scoped)
  );

  it.effect("runs different middlewares together, in the order given", () =>
    Effect.gen(function* twoMiddlewares() {
      const both = toHttpApi("BothApi", [whoAmI, lookup], {
        middleware: [Authenticated, ProblemBodies],
      });

      const handler = yield* serve(
        HttpApiBuilder.layer(both.api).pipe(
          Layer.provide(
            both.layer.pipe(
              Layer.provide(
                Layer.mergeAll(AuthenticatedLayer, ProblemBodiesLayer)
              )
            )
          )
        )
      );

      const signedIn = yield* fetchJson(
        handler,
        at("/items/a?window=abc", { headers: { "x-caller": "rat" } })
      );

      const anonymous = yield* fetchJson(handler, at("/items/a?window=abc"));

      const me = yield* fetchJson(
        handler,
        at("/me", { headers: { "x-caller": "rat" } })
      );

      expect([
        signedIn.status,
        signedIn.body,
        anonymous.status,
        me.body,
      ]).toEqual([
        400,
        { hint: "Fix the query.", status: 400, title: "Malformed request" },
        401,
        { name: "rat" },
      ]);
    }).pipe(Effect.scoped)
  );

  it("documents the middleware's refusal on every route", () => {
    const { paths } = guarded.openApi();

    expect([
      Object.keys(paths["/me"]?.get?.responses ?? {}),
      Object.keys(paths["/items/{item}"]?.get?.responses ?? {}),
    ]).toEqual([
      expect.arrayContaining(["200", "401"]),
      expect.arrayContaining(["200", "401", "422"]),
    ]);
  });

  it.effect("lets a host render decode refusals as its own body", () =>
    Effect.gen(function* decodeRefusal() {
      const plain = yield* serve(
        HttpApiBuilder.layer(routes.api).pipe(Layer.provide(routes.layer))
      );

      const problemBodies = toHttpApi("ShapedApi", [lookup], {
        middleware: [ProblemBodies],
      });

      const handler = yield* serve(
        HttpApiBuilder.layer(problemBodies.api).pipe(
          Layer.provide(
            problemBodies.layer.pipe(Layer.provide(ProblemBodiesLayer))
          )
        )
      );

      const bare = yield* fetchJson(plain, at("/items/a?window=abc"));
      const refused = yield* fetchJson(handler, at("/items/a?window=abc"));

      expect([bare.status, bare.body, refused]).toEqual([
        400,
        undefined,
        {
          body: {
            hint: "Fix the query.",
            status: 400,
            title: "Malformed request",
          },
          contentType: "application/problem+json",
          status: 400,
        },
      ]);
    }).pipe(Effect.scoped)
  );

  it.effect(
    "lets a host answer a typed failure with the status it carries",
    () =>
      Effect.gen(function* failureStatus() {
        const statuses = toHttpApi("StatusApi", [gate], {
          middleware: [ProblemStatus],
        });

        const handler = yield* serve(
          HttpApiBuilder.layer(statuses.api).pipe(
            Layer.provide(
              statuses.layer.pipe(Layer.provide(ProblemStatusLayer))
            )
          )
        );

        const gone = yield* fetchJson(handler, at("/gate/410"));
        const conflict = yield* fetchJson(handler, at("/gate/409"));

        expect([gone, conflict.status]).toEqual([
          {
            body: { status: 410, title: "Refused" },
            contentType: "application/problem+json",
            status: 410,
          },
          409,
        ]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "renders only the declared problem fields, and lets an undeclared failure fail closed",
    () =>
      Effect.gen(function* declaredOnly() {
        const statuses = toHttpApi("StatusApi", [gate], {
          middleware: [ProblemStatus],
        });

        const unrendered = toHttpApi("UnrenderedApi", [gate]);

        const rendered = yield* serve(
          HttpApiBuilder.layer(statuses.api).pipe(
            Layer.provide(
              statuses.layer.pipe(Layer.provide(ProblemStatusLayer))
            )
          )
        );

        const plain = yield* serve(
          HttpApiBuilder.layer(unrendered.api).pipe(
            Layer.provide(unrendered.layer)
          )
        );

        const leak = yield* fetchJson(rendered, at("/gate/409?mode=leak"));

        const undeclared = yield* fetchJson(
          rendered,
          at("/gate/409?mode=undeclared")
        );

        const undeclaredPlain = yield* fetchJson(
          plain,
          at("/gate/409?mode=undeclared")
        );

        expect([
          leak.status,
          leak.body,
          undeclared.status,
          JSON.stringify(undeclared.body ?? null).includes("hunter2"),
          undeclaredPlain.status,
        ]).toEqual([409, { status: 409, title: "Refused" }, 500, false, 500]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "trusts middleware: it may answer before the route decodes its input",
    () =>
      Effect.gen(function* trusted() {
        const closed = toHttpApi("ClosedApi", [lookup], {
          middleware: [Maintenance],
        });

        const handler = yield* serve(
          HttpApiBuilder.layer(closed.api).pipe(
            Layer.provide(closed.layer.pipe(Layer.provide(MaintenanceLayer)))
          )
        );

        const malformed = yield* fetchJson(handler, at("/items/a?window=abc"));

        expect([malformed.status, malformed.body]).toEqual([
          503,
          { maintenance: true },
        ]);
      }).pipe(Effect.scoped)
  );
});
