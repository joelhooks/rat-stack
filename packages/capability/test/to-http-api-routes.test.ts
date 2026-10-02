import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
  Etag,
  HttpPlatform,
  HttpRouter,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiTest } from "effect/http-api";

import { defineContract, implement, toHttpApi } from "../src/index.js";
import { NotFound, echo } from "./fixtures.js";
import {
  Caller,
  MissingRequestId,
  RESOURCE_METADATA,
  RequestId,
  callerFromRequest,
  renderRefusal,
  requestIdFromRequest,
} from "./http-hooks.js";

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
      challenge: response.headers.get("www-authenticate"),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  });

const fetchText = (
  handler: (request: Request) => Promise<Response>,
  request: Request
) =>
  Effect.gen(function* fetchedText() {
    // oxlint-disable-next-line typescript/promise-function-async -- HttpRouter exposes a Promise API for this in-memory web handler test.
    const response = yield* Effect.promise(() => handler(request));

    // oxlint-disable-next-line typescript/promise-function-async -- Web Response.text returns a Promise at this in-memory transport boundary.
    const text = yield* Effect.promise(() => response.text());

    return [response.status, response.headers.get("content-type"), text];
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

  it("documents bodyless decode failures for every routed endpoint", () => {
    for (const path of Object.values(routes.openApi().paths)) {
      for (const operation of [path.get, path.put, path.post]) {
        if (operation === undefined) {
          continue;
        }

        const badRequest = operation.responses["400"];
        expect(badRequest).toMatchObject({ description: "BadRequest" });
        expect(badRequest).not.toHaveProperty("content");
      }
    }
  });

  it.effect(
    "schema-failing requests retain the advertised empty 400 body",
    () =>
      Effect.gen(function* decodeRefusal() {
        const handler = yield* serve(
          HttpApiBuilder.layer(routes.api).pipe(Layer.provide(routes.layer))
        );

        const [status, contentType, body] = yield* fetchText(
          handler,
          at("/echo", {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        );

        expect(status).toBe(400);
        expect(contentType).toBeNull();
        expect(body).toBe("");
      }).pipe(Effect.scoped)
  );

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

const tracedContract = defineContract("traced", {
  description: "Name the caller and the request id the host read",
  failure: Schema.Never,
  http: { method: "GET", path: "/traced" },
  input: Schema.Struct({}),
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
});

const traced = implement(tracedContract, () =>
  Effect.gen(function* traceCall() {
    const caller = yield* Caller;
    const request = yield* RequestId;

    return { id: request.id, name: caller.name };
  })
);

const Gone = Schema.Struct({
  status: Schema.Literal(410),
  title: Schema.String,
}).annotate({ httpApiStatus: 410 });

const Conflict = Schema.Struct({
  status: Schema.Literal(409),
  title: Schema.String,
}).annotate({ httpApiStatus: 409 });

const gateContract = defineContract("gate", {
  description: "Refuse with a problem whose status is its own",
  failure: Schema.Union([Gone, Conflict]),
  http: { method: "GET", path: "/gate/:status" },
  input: Schema.Struct({
    mode: Schema.optional(Schema.Literals(["leak", "undeclared"])),
    status: Schema.Literals([409, 410]),
  }),
  output: Schema.String,
});

const undeclaredFailure: Partial<typeof Gone.Type> & {
  readonly secret: string;
} = { secret: "hunter2" };

const gate = implement(gateContract, ({ mode, status }) => {
  if (mode === "undeclared") {
    // SAFETY: this handler breaks its contract on purpose, failing with a value its failure schema refuses, to show that the projection fails closed.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Effect.fail(undeclaredFailure as typeof Gone.Type);
  }

  const refusal =
    status === 410
      ? { status, title: "Gone" as const }
      : { status, title: "Conflict" as const };

  return Effect.fail(
    mode === "leak" ? { ...refusal, secret: "hunter2" } : refusal
  );
});

const gates = toHttpApi("GateApi", [gate]);

const leakedResponse = HttpServerResponse.jsonUnsafe({
  secret: "must-not-leak",
});

const leakyContract = defineContract("leaky", {
  description: "Fail with an undeclared value that is itself a response",
  failure: Schema.Never,
  http: { method: "GET", path: "/leaky" },
  input: Schema.Struct({}),
  output: Schema.String,
});

const leaky = implement(leakyContract, () =>
  // SAFETY: this handler breaks its contract on purpose, failing with a response value its failure schema refuses, to show that the projection never answers with it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  Effect.fail(leakedResponse as never)
);

const mergedCalls: string[] = [];

const mergedContract = defineContract("merged", {
  description:
    "Read an input whose own check spans a path field and a query field",
  failure: Schema.Never,
  http: { method: "GET", path: "/merged/:id" },
  input: Schema.Struct({ id: Schema.String, value: Schema.String }).check(
    Schema.makeFilter(({ id, value }) => id !== value)
  ),
  output: Schema.String,
});

const merged = implement(mergedContract, ({ id }) =>
  Effect.sync(() => {
    mergedCalls.push(id);

    return id;
  })
);

const legacyGateContract = defineContract("legacyGate", {
  description: "Refuse with a union failure and no http route",
  failure: Schema.Union([Gone, Conflict]),
  input: Schema.Struct({}),
  output: Schema.String,
});

const legacyGate = implement(legacyGateContract, () =>
  Effect.fail({ status: 410 as const, title: "Gone" })
);

const CheckedRefusal = Schema.Union([Gone, Conflict]).check(
  Schema.makeFilter(({ title }) => title !== "Forbidden")
);

const checkedGateContract = defineContract("checkedGate", {
  description:
    "Refuse with a value a member accepts and the union's own check refuses",
  failure: CheckedRefusal,
  http: { method: "GET", path: "/checked-gate" },
  input: Schema.Struct({ title: Schema.String }),
  output: Schema.String,
});

const checkedGate = implement(checkedGateContract, ({ title }) =>
  Effect.fail({ status: 410 as const, title })
);

describe("toHttpApi provide hooks", () => {
  const guarded = toHttpApi("GuardedApi", [whoAmI, lookup], {
    provide: [callerFromRequest],
  });

  it.effect(
    "provides a service from the request before every route, and refuses with its declared failure",
    () =>
      Effect.gen(function* provided() {
        const handler = yield* serve(
          HttpApiBuilder.layer(guarded.api).pipe(Layer.provide(guarded.layer))
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
          anonymous,
          anonymousLookup.status,
        ]).toEqual([
          200,
          { name: "rat" },
          {
            body: { title: "Sign in first" },
            challenge: RESOURCE_METADATA,
            contentType: "application/json",
            status: 401,
          },
          401,
        ]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "infers a list of different hooks, each providing its own service",
    () =>
      Effect.gen(function* hooks() {
        const both = toHttpApi("BothApi", [traced], {
          provide: [callerFromRequest, requestIdFromRequest],
        });

        const handler = yield* serve(
          HttpApiBuilder.layer(both.api).pipe(Layer.provide(both.layer))
        );

        const complete = yield* fetchJson(
          handler,
          at("/traced", {
            headers: { "x-caller": "rat", "x-request-id": "r1" },
          })
        );

        const unmarked = yield* fetchJson(
          handler,
          at("/traced", { headers: { "x-caller": "rat" } })
        );

        expect([complete.body, unmarked.status, unmarked.body]).toEqual([
          { id: "r1", name: "rat" },
          400,
          MissingRequestId.make({ header: "x-request-id" }),
        ]);
      }).pipe(Effect.scoped)
  );

  it("types each hook's from against its tag's service and its declared failure", () => {
    const wrongService = toHttpApi("WrongServiceApi", [whoAmI], {
      provide: [
        {
          failure: Schema.Never,
          // @ts-expect-error -- from must answer the tag's service, not a number.
          from: () => Effect.succeed(123),
          tag: Caller,
        },
      ],
    });

    const undeclared = toHttpApi("UndeclaredApi", [whoAmI], {
      provide: [
        {
          failure: Schema.Never,
          // @ts-expect-error -- from may fail only with its declared failure.
          // @effect-diagnostics-next-line missingEffectError:off -- this hook fails with an undeclared value on purpose, to prove the type error.
          from: () => Effect.fail("undeclared"),
          tag: Caller,
        },
      ],
    });

    expect([wrongService.api.identifier, undeclared.api.identifier]).toEqual([
      "WrongServiceApi",
      "UndeclaredApi",
    ]);
  });

  it("documents each hook's refusal on every route", () => {
    const { paths } = guarded.openApi();

    expect([
      Object.keys(paths["/me"]?.get?.responses ?? {}),
      Object.keys(paths["/items/{item}"]?.get?.responses ?? {}),
    ]).toEqual([
      expect.arrayContaining(["200", "401"]),
      expect.arrayContaining(["200", "401", "422"]),
    ]);
  });

  it.effect(
    "renders a refusal of the merged path and query input through decodeRefusal, without running the handler",
    () =>
      Effect.gen(function* mergedRefusal() {
        const rendered = toHttpApi("MergedApi", [merged], {
          decodeRefusal: renderRefusal,
        });

        const handler = yield* serve(
          HttpApiBuilder.layer(rendered.api).pipe(Layer.provide(rendered.layer))
        );

        const refused = yield* fetchJson(handler, at("/merged/a?value=a"));
        const allowed = yield* fetchJson(handler, at("/merged/a?value=b"));

        expect([
          refused.status,
          refused.body,
          allowed.body,
          mergedCalls,
        ]).toEqual([
          400,
          { hint: "Fix the params.", status: 400, title: "Malformed request" },
          "a",
          ["a"],
        ]);
      }).pipe(Effect.scoped)
  );

  it.effect("lets the host render decode refusals as its own body", () =>
    Effect.gen(function* decodeRefusal() {
      const plain = yield* serve(
        HttpApiBuilder.layer(routes.api).pipe(Layer.provide(routes.layer))
      );

      const rendered = toHttpApi("RenderedApi", [lookup], {
        decodeRefusal: renderRefusal,
      });

      const handler = yield* serve(
        HttpApiBuilder.layer(rendered.api).pipe(Layer.provide(rendered.layer))
      );

      const bare = yield* fetchJson(plain, at("/items/a?window=abc"));
      const refused = yield* fetchJson(handler, at("/items/a?window=abc"));
      const found = yield* fetchJson(handler, at("/items/a?window=5"));

      expect([
        bare.status,
        bare.body,
        refused.status,
        refused.contentType,
        refused.body,
        found.body,
      ]).toEqual([
        400,
        undefined,
        400,
        "application/problem+json",
        { hint: "Fix the query.", status: 400, title: "Malformed request" },
        { item: "a", window: 5 },
      ]);
    }).pipe(Effect.scoped)
  );
});

describe("toHttpApi failures", () => {
  it.effect(
    "answers each member of a failure union with that member's status, through its schema only",
    () =>
      Effect.gen(function* unionStatuses() {
        const handler = yield* serve(
          HttpApiBuilder.layer(gates.api).pipe(Layer.provide(gates.layer))
        );

        const gone = yield* fetchJson(handler, at("/gate/410"));
        const conflict = yield* fetchJson(handler, at("/gate/409?mode=leak"));

        expect([
          gone.status,
          gone.body,
          conflict.status,
          conflict.body,
        ]).toEqual([
          410,
          { status: 410, title: "Gone" },
          409,
          { status: 409, title: "Conflict" },
        ]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "fails closed with an empty 500 on a failure its schema does not declare",
    () =>
      Effect.gen(function* undeclared() {
        const handler = yield* serve(
          HttpApiBuilder.layer(gates.api).pipe(Layer.provide(gates.layer))
        );

        const refused = yield* fetchJson(
          handler,
          at("/gate/410?mode=undeclared")
        );

        expect([refused.status, refused.body]).toEqual([500, undefined]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "honors member status on a default POST without changing the error body",
    () =>
      Effect.gen(function* defaultMemberStatus() {
        const legacy = toHttpApi("LegacyApi", [legacyGate]);

        const handler = yield* serve(
          HttpApiBuilder.layer(legacy.api).pipe(Layer.provide(legacy.layer))
        );

        const refused = yield* fetchText(
          handler,
          at("/legacyGate", {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        );

        expect(refused).toEqual([
          410,
          "application/json",
          '{"status":410,"title":"Gone"}',
        ]);
        expect(
          Object.keys(
            legacy.openApi().paths["/legacyGate"]?.post?.responses ?? {}
          )
        ).toEqual(["200", "400", "409", "410"]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "fails closed when a value matches a member but not the union's own check",
    () =>
      Effect.gen(function* unionCheck() {
        const checked = toHttpApi("CheckedApi", [checkedGate]);

        const handler = yield* serve(
          HttpApiBuilder.layer(checked.api).pipe(Layer.provide(checked.layer))
        );

        const allowed = yield* fetchJson(
          handler,
          at("/checked-gate?title=Gone")
        );

        const refused = yield* fetchJson(
          handler,
          at("/checked-gate?title=Forbidden")
        );

        expect([allowed.status, refused.status, refused.body]).toEqual([
          410,
          500,
          undefined,
        ]);
      }).pipe(Effect.scoped)
  );

  it.effect(
    "fails closed with an empty 500 when an undeclared failure is itself a response",
    () =>
      Effect.gen(function* responseFailure() {
        const leaks = toHttpApi("LeakyApi", [leaky]);

        const handler = yield* serve(
          HttpApiBuilder.layer(leaks.api).pipe(Layer.provide(leaks.layer))
        );

        const refused = yield* fetchText(handler, at("/leaky"));

        expect([refused[0], refused[2]]).toEqual([500, ""]);
      }).pipe(Effect.scoped)
  );

  it("documents each member's status", () => {
    const responses =
      gates.openApi().paths["/gate/{status}"]?.get?.responses ?? {};

    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining(["200", "409", "410"])
    );
  });
});
