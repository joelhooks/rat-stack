import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

export class ProblemBodies extends HttpApiMiddleware.Service<ProblemBodies>()(
  "@rat-stack/capability/test/ProblemBodies"
) {}

export const ProblemBodiesLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  ProblemBodies,
  (refusal) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        {
          hint: `Fix the ${refusal.kind.toLowerCase()}.`,
          status: 400,
          title: "Malformed request",
        },
        { contentType: "application/problem+json", status: 400 }
      )
    )
);
