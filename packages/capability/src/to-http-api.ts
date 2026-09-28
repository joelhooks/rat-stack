// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- See to-toolkit.ts: a projection over a heterogeneous list erases error and requirement types at the boundary and recovers them for callers.
import { Data, Effect, Layer, Predicate, Schema, SchemaAST } from "effect";
import type { Context, JsonSchema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import type { HttpServerResponse } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  OpenApi,
} from "effect/unstable/httpapi";

import { ApprovalDenied } from "./approval.js";
import { failureSchemaOf } from "./contract.js";
import type {
  AnyCapability,
  AnyContract,
  FailureOf,
  HttpMethod,
  HttpRoute,
  HttpRouteOf,
  InputOf,
  InputSchema,
  NameOf,
  OutputOf,
  PathParamNames,
  PlainSchema,
} from "./contract.js";
import { inputJsonSchemaOf } from "./input-json-schema.js";
import type { RequirementsOf } from "./to-toolkit.js";

export const GROUP = "capabilities";

// SAFETY: `HttpApiEndpoint.post` checks at the type level that the error schema is not a streaming schema, through a non-exported conditional type that a generic `Failure` cannot satisfy. A plain schema is never a stream, so the runtime call goes through this loosely typed alias and `EndpointOf` names the precise endpoint type separately.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
const post = HttpApiEndpoint.post as unknown as (
  name: string,
  path: `/${string}`,
  options: {
    readonly error: Schema.Top | readonly Schema.Top[];
    readonly payload: InputSchema;
    readonly success: PlainSchema;
  }
) => HttpApiEndpoint.Constraint;

// SAFETY: as for `post`: `HttpApiEndpoint.make(method)` rejects a generic error schema only through its non-exported stream check, and `RoutedEndpointOf` names the precise endpoint type separately.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
const route = HttpApiEndpoint.make as unknown as (method: HttpMethod) => (
  name: string,
  path: `/${string}`,
  options: {
    readonly error: Schema.Top | readonly Schema.Top[];
    readonly params?: Schema.Top | undefined;
    readonly payload?: Schema.Top | undefined;
    readonly query?: Schema.Top | undefined;
    readonly success: PlainSchema;
  }
) => HttpApiEndpoint.Constraint;

const BODY_METHODS: ReadonlySet<HttpMethod> = new Set(["PATCH", "POST", "PUT"]);

type BodyMethod = "PATCH" | "POST" | "PUT";

const pathParamNames = (path: string): readonly string[] =>
  path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));

const DEFAULT_FAILURE_STATUS = 422;

const withFailureStatus = (failure: Schema.Top): Schema.Top =>
  failure.ast.annotations?.httpApiStatus === undefined
    ? failure.annotate({ httpApiStatus: DEFAULT_FAILURE_STATUS })
    : failure;

const membersOf = (failure: Schema.Top): readonly Schema.Top[] => {
  if (
    !SchemaAST.isUnion(failure.ast) ||
    failure.ast.annotations?.httpApiStatus !== undefined ||
    !Predicate.hasProperty(failure, "members") ||
    !Array.isArray(failure.members)
  ) {
    return [failure];
  }

  return failure.members.filter((member) => Schema.isSchema(member));
};

class UndeclaredFailure extends Data.TaggedError("UndeclaredFailure")<{
  readonly cause: unknown;
  readonly contract: string;
}> {}

const declaredFailuresOnly = (contract: AnyContract) => {
  const isDeclared = Schema.is(failureSchemaOf(contract));

  return <A, R>(
    handled: Effect.Effect<A, unknown, R>
  ): Effect.Effect<A, unknown, R> =>
    Effect.catchIf(
      handled,
      (failure) => !isDeclared(failure),
      (failure) =>
        Effect.die(
          new UndeclaredFailure({ cause: failure, contract: contract.name })
        )
    );
};

const httpFailure = (contract: AnyContract): readonly Schema.Top[] => {
  if (contract.http === undefined) {
    return contract.needsApproval
      ? [withFailureStatus(contract.failure), ApprovalDenied]
      : [withFailureStatus(failureSchemaOf(contract))];
  }

  return [
    ...membersOf(contract.failure).map(withFailureStatus),
    ...(contract.needsApproval ? [ApprovalDenied] : []),
  ];
};

type ParamFieldsOf<C, Path extends string> = Pick<
  InputOf<C>["fields"],
  PathParamNames<Path> & keyof InputOf<C>["fields"]
>;

type RestFieldsOf<C, Path extends string> = Omit<
  InputOf<C>["fields"],
  PathParamNames<Path>
>;

type RoutedEndpointOf<
  C,
  Route extends HttpRoute,
> = HttpApiEndpoint.HttpApiEndpoint<
  NameOf<C>,
  Route["method"],
  Route["path"],
  [PathParamNames<Route["path"]>] extends [never]
    ? never
    : Schema.Struct<ParamFieldsOf<C, Route["path"]>>,
  Route["method"] extends BodyMethod
    ? never
    : Schema.Struct<RestFieldsOf<C, Route["path"]>>,
  Route["method"] extends BodyMethod
    ? Schema.Struct<RestFieldsOf<C, Route["path"]>>
    : never,
  never,
  OutputOf<C>,
  FailureOf<C>
>;

export type EndpointOf<C> =
  HttpRouteOf<C> extends HttpRoute
    ? RoutedEndpointOf<C, HttpRouteOf<C>>
    : PostEndpointOf<C>;

type PostEndpointOf<C> = ReturnType<
  typeof HttpApiEndpoint.post<
    NameOf<C>,
    `/${NameOf<C>}`,
    never,
    never,
    InputOf<C>,
    never,
    OutputOf<C>,
    FailureOf<C>
  >
>;

const groupFor = <
  const Endpoints extends readonly [
    HttpApiEndpoint.Constraint,
    ...HttpApiEndpoint.Constraint[],
  ],
>(
  ...endpoints: Endpoints
) => HttpApiGroup.make(GROUP).add(...endpoints);

const apiFor = <const Id extends string, Group extends HttpApiGroup.Constraint>(
  id: Id,
  group: Group
) =>
  HttpApi.make(id)
    .add(group)
    .annotateMerge(OpenApi.annotations({ title: id }));

export type EndpointsOf<Caps extends readonly AnyCapability[]> = {
  readonly [K in keyof Caps]: EndpointOf<Caps[K]>;
};

type UnmiddledGroupOf<Caps extends readonly AnyCapability[]> = ReturnType<
  typeof groupFor<
    EndpointsOf<Caps> extends readonly [
      HttpApiEndpoint.Constraint,
      ...HttpApiEndpoint.Constraint[],
    ]
      ? EndpointsOf<Caps>
      : never
  >
>;

export type GroupOf<
  Caps extends readonly AnyCapability[],
  Middleware extends HttpApiMiddleware.AnyId = never,
> = [Middleware] extends [never]
  ? UnmiddledGroupOf<Caps>
  : HttpApiGroup.HttpApiGroup<
      typeof GROUP,
      HttpApiEndpoint.AddMiddleware<EndpointsOf<Caps>[number], Middleware>
    >;

export type ApiOf<
  Id extends string,
  Caps extends readonly AnyCapability[],
  Middleware extends HttpApiMiddleware.AnyId = never,
> = ReturnType<typeof apiFor<Id, GroupOf<Caps, Middleware>>>;

export interface HttpProvide<
  Id,
  Service,
  Failure extends Schema.Top,
  Requirements,
> {
  readonly failure: Failure;
  readonly from: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<Service, Failure["Type"], Requirements>;
  readonly tag: Context.Key<Id, Service>;
}

export type AnyHttpProvide = HttpProvide<unknown, unknown, Schema.Top, unknown>;

export interface ProvideMiddleware<
  Id,
  Failure extends Schema.Top,
  Requirements,
> {
  readonly "~effect/httpapi/HttpApiMiddleware": {
    readonly clientError: never;
    readonly error: Failure;
    readonly provides: Id;
    readonly requiredForClient: false;
    readonly requires: Requirements;
  };
}

export type MiddlewareOf<Hooks extends readonly AnyHttpProvide[]> =
  Hooks[number] extends infer Hook
    ? Hook extends {
        readonly failure: infer Failure extends Schema.Top;
        readonly from: (
          request: never
        ) => Effect.Effect<unknown, unknown, infer Requirements>;
        readonly tag: Context.Key<infer Id, unknown>;
      }
      ? ProvideMiddleware<Id, Failure, Requirements>
      : never
    : never;

export type CheckedHook<Hook> = Hook extends {
  readonly failure: infer Failure extends Schema.Top;
  readonly from: (
    request: never
  ) => Effect.Effect<unknown, unknown, infer Requirements>;
  readonly tag: Context.Key<infer Id, infer Service>;
}
  ? HttpProvide<Id, Service, Failure, Requirements>
  : never;

export type CheckedHooks<Hooks extends readonly AnyHttpProvide[]> = {
  readonly [K in keyof Hooks]: CheckedHook<Hooks[K]>;
};

export interface HttpApiProjectionOptions<
  Hooks extends readonly AnyHttpProvide[] = readonly [],
> {
  readonly decodeRefusal?:
    | ((
        refusal: HttpApiError.HttpApiSchemaError
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse>)
    | undefined;
  readonly errors?: readonly Schema.Top[] | undefined;
  readonly prefix?: `/${string}` | undefined;
  readonly provide?: Hooks | undefined;
}

export interface HttpApiProjection<
  Id extends string,
  Caps extends readonly AnyCapability[],
  Middleware extends HttpApiMiddleware.AnyId = never,
> {
  readonly api: ApiOf<Id, Caps, Middleware>;
  readonly layer: Layer.Layer<
    HttpApiGroup.ToService<Id, GroupOf<Caps, Middleware>> | Middleware,
    never,
    | Exclude<RequirementsOf<Caps>, HttpApiMiddleware.Provides<Middleware>>
    | HttpApiMiddleware.Requires<Middleware>
  >;
  readonly openApi: () => OpenApi.OpenAPISpec;
}

const routedEndpoint = (
  contract: AnyContract,
  http: HttpRoute,
  error: readonly Schema.Top[]
): HttpApiEndpoint.Constraint => {
  const names = pathParamNames(http.path);
  const { fields } = contract.input;

  for (const name of names) {
    if (!Object.hasOwn(fields, name)) {
      throw new Error(
        `toHttpApi: ${contract.name}'s path ${http.path} names :${name}, which is not an input field`
      );
    }
  }

  const params = Object.fromEntries(
    Object.entries(fields).filter(([name]) => names.includes(name))
  );

  const input =
    names.length === 0
      ? contract.input
      : Schema.Struct(
          Object.fromEntries(
            Object.entries(fields).filter(([name]) => !names.includes(name))
          )
        );

  return route(http.method)(contract.name, http.path, {
    error,
    params: names.length === 0 ? undefined : Schema.Struct(params),
    success: contract.output,
    ...(BODY_METHODS.has(http.method) ? { payload: input } : { query: input }),
  });
};

type RequestPart = object | undefined;

const inputOf = (
  contract: AnyContract,
  request: {
    readonly params?: RequestPart;
    readonly payload?: RequestPart;
    readonly query?: RequestPart;
  }
): Effect.Effect<unknown, HttpApiError.HttpApiSchemaError> => {
  if (contract.http === undefined) {
    return Effect.succeed(request.payload);
  }

  const parts = BODY_METHODS.has(contract.http.method)
    ? request.payload
    : request.query;

  if (pathParamNames(contract.http.path).length === 0) {
    return Effect.succeed(parts);
  }

  return HttpApiError.HttpApiSchemaError.wrap(
    "Params",
    Schema.decodeEffect(Schema.toType(contract.input))({
      ...request.params,
      ...parts,
    })
  );
};

interface HostMiddleware {
  readonly key: Context.Key<HttpApiMiddleware.AnyId, unknown>;
  readonly layer: Layer.Layer<never>;
}

const REQUEST_REFUSALS: ReadonlySet<HttpApiError.HttpApiSchemaError["kind"]> =
  new Set(["Headers", "Params", "Payload", "Query"]);

const provideMiddleware = (
  id: string,
  hook: AnyHttpProvide,
  index: number
): HostMiddleware => {
  const key = HttpApiMiddleware.Service<HostMiddleware>()(
    `@rat-stack/capability/${id}/provide/${String(index)}`,
    { error: hook.failure }
  );

  const provideFromRequest = (
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>
  ) =>
    HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap(hook.from),
      Effect.flatMap((service) =>
        Effect.provideService(httpEffect, hook.tag, service)
      )
    );

  // SAFETY: the hook's requirements are erased to `unknown` here; the builder runs middleware in the group layer's context, which `HttpApiProjection["layer"]` requires to hold them.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const layer = Layer.succeed(key, provideFromRequest as never);

  // SAFETY: the key is the middleware service this layer builds; its phantom identity and the hook's erased requirements are recovered for callers by `MiddlewareOf`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  return { key, layer } as unknown as HostMiddleware;
};

const refusalMiddleware = (
  id: string,
  render: (
    refusal: HttpApiError.HttpApiSchemaError
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>
): HostMiddleware => {
  const key = HttpApiMiddleware.Service<HostMiddleware>()(
    `@rat-stack/capability/${id}/decode-refusal`
  );

  const layer = HttpApiMiddleware.layerSchemaErrorTransform(key, (refusal) =>
    REQUEST_REFUSALS.has(refusal.kind) ? render(refusal) : Effect.fail(refusal)
  );

  // SAFETY: as for `provideMiddleware`: the key is the middleware service this layer builds.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  return { key, layer } as unknown as HostMiddleware;
};

const withMiddleware = (
  group: HttpApiGroup.Constraint,
  middleware: readonly HostMiddleware[]
): HttpApiGroup.Constraint => {
  const [next, ...others] = middleware;

  if (next === undefined) {
    return group;
  }

  // SAFETY: every group here comes from `groupFor`, an `HttpApiGroup`; `middleware` changes only each endpoint's middleware services, which `GroupOf` recomputes for callers from the same hooks.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const httpGroup = group as HttpApiGroup.Top;

  return withMiddleware(httpGroup.middleware(next.key), others);
};

const withPrefix = <Id extends string>(
  api: HttpApi.HttpApi<Id, HttpApiGroup.Constraint>,
  prefix: `/${string}` | undefined
): HttpApi.HttpApi<Id, HttpApiGroup.Constraint> => {
  if (prefix === undefined) {
    return api;
  }

  // SAFETY: prefixing changes endpoint paths only; the builder and OpenAPI read the prefixed paths at runtime.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  return api.prefix(prefix) as unknown as HttpApi.HttpApi<
    Id,
    HttpApiGroup.Constraint
  >;
};

export const toHttpApi = <
  const Id extends string,
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
  const Hooks extends readonly AnyHttpProvide[] = readonly [],
>(
  id: Id,
  capabilities: Caps,
  options?: HttpApiProjectionOptions<Hooks> & {
    readonly provide?: CheckedHooks<Hooks> | undefined;
  }
): HttpApiProjection<Id, Caps, MiddlewareOf<Hooks>> => {
  const hostErrors = options?.errors ?? [];

  const endpoints = capabilities.map(({ contract }) => {
    const error = [...httpFailure(contract), ...hostErrors];

    return contract.http === undefined
      ? post(contract.name, `/${contract.name}`, {
          error,
          payload: contract.input,
          success: contract.output,
        })
      : routedEndpoint(contract, contract.http, error);
  });

  const [first, ...rest] = endpoints;

  if (first === undefined) {
    throw new Error("toHttpApi needs at least one capability");
  }

  const middleware = [
    ...(options?.provide ?? []).map((hook, index) =>
      provideMiddleware(id, hook, index)
    ),
    ...(options?.decodeRefusal === undefined
      ? []
      : [refusalMiddleware(id, options.decodeRefusal)]),
  ];

  const projectedApi = withPrefix(
    apiFor(id, withMiddleware(groupFor(first, ...rest), middleware)),
    options?.prefix
  );

  // SAFETY: prefixing changes endpoint paths but not the API id, group id, schemas, or handler service. Keep the stable public type while preserving that runtime path transformation for HttpApiBuilder and OpenAPI.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const api = projectedApi as unknown as ApiOf<Id, Caps, MiddlewareOf<Hooks>>;

  const implementations: Record<
    string,
    (request: {
      readonly params?: RequestPart;
      readonly payload?: RequestPart;
      readonly query?: RequestPart;
    }) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>
  > = {};

  for (const capability of capabilities) {
    // SAFETY: `Any` erased this capability's requirements to `unknown`; they are a subset of `RequirementsOf<Caps>`. HttpApi decodes the payload.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const run = capability.handler as (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      input: unknown
    ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

    const failureGuard =
      capability.contract.http === undefined
        ? <A, E, R>(handled: Effect.Effect<A, E, R>) => handled
        : declaredFailuresOnly(capability.contract);

    implementations[capability.contract.name] = (request) =>
      Effect.flatMap(inputOf(capability.contract, request), (input) =>
        failureGuard(run(input))
      );
  }

  // SAFETY: `handleAll` wants a record keyed by the group's endpoint identifiers with each handler typed to its endpoint; that is what `implementations` is at runtime, but a loop cannot say so. `never` is accepted by every parameter type, so the call stays checked on its return side.
  const built = HttpApiBuilder.group(projectedApi, GROUP, (handlers) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    handlers.handleAll(implementations as never)
  );

  const [firstMiddleware, ...otherMiddleware] = middleware;

  const withHostMiddleware =
    firstMiddleware === undefined
      ? built
      : Layer.provideMerge(
          built,
          Layer.mergeAll(
            firstMiddleware.layer,
            ...otherMiddleware.map(
              ({ layer: middlewareLayer }) => middlewareLayer
            )
          )
        );

  // SAFETY: `withHostMiddleware` is the layer for exactly the group `api` names, plus the middleware services the hooks build, which is what `HttpApiProjection["layer"]` spells out.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const layer = withHostMiddleware as unknown as HttpApiProjection<
    Id,
    Caps,
    MiddlewareOf<Hooks>
  >["layer"];

  const emptyInputsByOperationId: ReadonlyMap<string, JsonSchema.JsonSchema> =
    new Map(
      capabilities
        .filter(
          ({ contract }) => Object.keys(contract.input.fields).length === 0
        )
        .map(({ contract }) => [
          `${GROUP}.${contract.name}`,
          inputJsonSchemaOf(contract.input),
        ])
    );

  const openApi = (): OpenApi.OpenAPISpec => {
    const document = OpenApi.fromApi(api);

    if (emptyInputsByOperationId.size === 0) {
      return document;
    }

    const paths = Object.fromEntries(
      Object.entries(document.paths).map(([path, pathItem]) => {
        const operation = pathItem.post;
        const requestBody = operation?.requestBody;

        const inputSchema =
          operation === undefined
            ? undefined
            : emptyInputsByOperationId.get(operation.operationId);

        if (
          operation === undefined ||
          requestBody === undefined ||
          inputSchema === undefined
        ) {
          return [path, pathItem];
        }

        const content = Object.fromEntries(
          Object.entries(requestBody.content).map(
            ([contentType, mediaType]) => [
              contentType,
              { ...mediaType, schema: inputSchema },
            ]
          )
        );

        return [
          path,
          {
            ...pathItem,
            post: {
              ...operation,
              requestBody: { ...requestBody, content },
            },
          },
        ];
      })
    );

    return { ...document, paths };
  };

  return { api, layer, openApi };
};
