import { Context, Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { HttpServerRequest } from "effect/unstable/http";
import { HttpApiSchema } from "effect/unstable/httpapi";
import type { HttpApiError } from "effect/unstable/httpapi";

export interface CallerService {
  readonly name: string;
}

export const Caller = Context.Service<CallerService, CallerService>(
  "@rat-stack/capability/test/Caller"
);

export const RESOURCE_METADATA =
  'Bearer resource_metadata="https://api.test/.well-known/oauth-protected-resource"';

const UnauthenticatedValue = Schema.TaggedStruct("Unauthenticated", {
  challenge: Schema.String,
});

export const Unauthenticated = UnauthenticatedValue.pipe(
  HttpApiSchema.encodeToWithHeaders(
    {
      body: Schema.Struct({ title: Schema.String }).annotate({
        httpApiStatus: 401,
      }),
      headers: { "www-authenticate": Schema.String },
    },
    {
      decode: ({ headers }) =>
        UnauthenticatedValue.make({ challenge: headers["www-authenticate"] }),
      encode: ({ challenge }) => ({
        body: { title: "Sign in first" },
        headers: { "www-authenticate": challenge },
      }),
    }
  )
);

export const callerFromRequest = {
  failure: Unauthenticated,
  from: (request: HttpServerRequest.HttpServerRequest) => {
    const name = request.headers["x-caller"];

    return name === undefined
      ? Effect.fail(UnauthenticatedValue.make({ challenge: RESOURCE_METADATA }))
      : Effect.succeed({ name });
  },
  tag: Caller,
};

export interface RequestIdService {
  readonly id: string;
}

export const RequestId = Context.Service<RequestIdService, RequestIdService>(
  "@rat-stack/capability/test/RequestId"
);

export const MissingRequestId = Schema.TaggedStruct("MissingRequestId", {
  header: Schema.String,
}).annotate({ httpApiStatus: 400 });

export const requestIdFromRequest = {
  failure: MissingRequestId,
  from: (request: HttpServerRequest.HttpServerRequest) => {
    const id = request.headers["x-request-id"];

    return id === undefined
      ? Effect.fail(MissingRequestId.make({ header: "x-request-id" }))
      : Effect.succeed({ id });
  },
  tag: RequestId,
};

export const renderRefusal = (refusal: HttpApiError.HttpApiSchemaError) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        hint: `Fix the ${refusal.kind.toLowerCase()}.`,
        status: 400,
        title: "Malformed request",
      },
      { contentType: "application/problem+json", status: 400 }
    )
  );
