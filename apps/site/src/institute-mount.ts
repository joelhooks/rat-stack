import { Effect, Option, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { isInstitutePath } from "./institute-paths.js";
import { instituteVisibilityFor } from "./institute-visibility.js";
import { instituteContentSecurityPolicy, secureResponse } from "./security.js";
import { AssetBindingSchema } from "./static-assets.js";

export const instituteStage = "institute-private";

export const withInstitute = (environment: {
  readonly ALCHEMY_STAGE?: unknown;
  readonly INSTITUTE?: unknown;
  readonly INSTITUTE_ENABLED?: unknown;
  readonly WEBSITE?: unknown;
}) => {
  const { enabled } = instituteVisibilityFor(environment);

  const legacy = Schema.decodeUnknownOption(AssetBindingSchema)(
    environment.INSTITUTE
  );

  const binding = legacy.pipe(
    Option.orElse(() =>
      Schema.decodeUnknownOption(AssetBindingSchema)(environment.WEBSITE)
    )
  );

  const privateStage = environment.ALCHEMY_STAGE === instituteStage;

  return <E, R>(
    fallback: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ) => {
    const dispatch =
      !enabled || Option.isNone(binding)
        ? fallback
        : Effect.gen(function* routeInstitute() {
            const request = yield* HttpServerRequest.HttpServerRequest;

            const original = yield* HttpServerRequest.toWeb(request).pipe(
              Effect.orDie
            );

            const { hostname, pathname } = new URL(original.url);

            const allowedHost =
              hostname === "ratstack.sh" ||
              (privateStage && hostname !== "www.ratstack.sh");

            if (!allowedHost || !isInstitutePath(pathname)) {
              return yield* fallback;
            }

            const institute = binding.value;

            const response = yield* Effect.promise(
              institute.fetch.bind(institute, original)
            );

            const web = HttpServerResponse.fromWeb(response);

            return Option.isSome(legacy)
              ? web
              : secureResponse(web, instituteContentSecurityPolicy);
          });

    return privateStage
      ? dispatch.pipe(
          Effect.map(HttpServerResponse.setHeader("x-robots-tag", "noindex"))
        )
      : dispatch;
  };
};
