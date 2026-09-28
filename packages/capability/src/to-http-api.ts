// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- See to-toolkit.ts: a projection over a heterogeneous list erases error and requirement types at the boundary and recovers them for callers.
import { Effect, Schema } from "effect";
import type { Context, JsonSchema, Layer } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";
import type { HttpApiMiddleware } from "effect/unstable/httpapi";

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

const withFailureStatus = (failure: PlainSchema): Schema.Top =>
  failure.ast.annotations?.httpApiStatus === undefined
    ? failure.annotate({ httpApiStatus: DEFAULT_FAILURE_STATUS })
    : failure;

const httpFailure = (contract: AnyContract): readonly Schema.Top[] =>
  contract.needsApproval
    ? [withFailureStatus(contract.failure), ApprovalDenied]
    : [withFailureStatus(failureSchemaOf(contract))];

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

export type MiddlewareKey = Context.Key<HttpApiMiddleware.AnyId, unknown>;

export type MiddlewareOf<Keys extends readonly MiddlewareKey[]> =
  Keys[number] extends Context.Key<infer Middleware, unknown>
    ? Middleware extends HttpApiMiddleware.AnyId
      ? Middleware
      : never
    : never;

export interface HttpApiProjectionOptions<
  Keys extends readonly MiddlewareKey[] = readonly [],
> {
  readonly errors?: readonly Schema.Top[] | undefined;
  readonly middleware?: Keys | undefined;
  readonly prefix?: `/${string}` | undefined;
}

export interface HttpApiProjection<
  Id extends string,
  Caps extends readonly AnyCapability[],
  Middleware extends HttpApiMiddleware.AnyId = never,
> {
  readonly api: ApiOf<Id, Caps, Middleware>;
  readonly layer: Layer.Layer<
    HttpApiGroup.ToService<Id, GroupOf<Caps, Middleware>>,
    never,
    | Exclude<RequirementsOf<Caps>, HttpApiMiddleware.Provides<Middleware>>
    | Middleware
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

const withMiddleware = (
  group: HttpApiGroup.Constraint,
  middleware: readonly MiddlewareKey[]
): HttpApiGroup.Constraint => {
  const [next, ...others] = middleware;

  if (next === undefined) {
    return group;
  }

  // SAFETY: every group here comes from `groupFor`, an `HttpApiGroup`; `middleware` changes only each endpoint's middleware services, which `GroupOf` recomputes for callers from the same middleware list.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return withMiddleware((group as HttpApiGroup.Top).middleware(next), others);
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
  const Keys extends readonly MiddlewareKey[] = readonly [],
>(
  id: Id,
  capabilities: Caps,
  options?: HttpApiProjectionOptions<Keys>
): HttpApiProjection<Id, Caps, MiddlewareOf<Keys>> => {
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

  const projectedApi = withPrefix(
    apiFor(
      id,
      withMiddleware(groupFor(first, ...rest), options?.middleware ?? [])
    ),
    options?.prefix
  );

  // SAFETY: prefixing changes endpoint paths but not the API id, group id, schemas, or handler service. Keep the stable public type while preserving that runtime path transformation for HttpApiBuilder and OpenAPI.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const api = projectedApi as unknown as ApiOf<Id, Caps, MiddlewareOf<Keys>>;

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

    implementations[capability.contract.name] = (request) =>
      Effect.flatMap(inputOf(capability.contract, request), run);
  }

  // SAFETY: `handleAll` wants a record keyed by the group's endpoint identifiers with each handler typed to its endpoint; that is what `implementations` is at runtime, but a loop cannot say so. `never` is accepted by every parameter type, so the call stays checked on its return side.
  const built = HttpApiBuilder.group(projectedApi, GROUP, (handlers) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    handlers.handleAll(implementations as never)
  );

  // SAFETY: `built` is the layer for exactly the group `api` names, which is what `HttpApiProjection<Id, Caps>["layer"]` spells out.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const layer = built as unknown as HttpApiProjection<
    Id,
    Caps,
    MiddlewareOf<Keys>
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
