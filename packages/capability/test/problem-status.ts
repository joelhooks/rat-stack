import { Effect, Layer, Schema } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

export const Problem = Schema.Struct({
  status: Schema.Finite,
  title: Schema.String,
});

const isProblem = Schema.is(Problem);

export class ProblemStatus extends HttpApiMiddleware.Service<ProblemStatus>()(
  "@rat-stack/capability/test/ProblemStatus"
) {}

export const ProblemStatusLayer = Layer.succeed(ProblemStatus, (httpEffect) =>
  Effect.catchIf(httpEffect, isProblem, (problem) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(problem, {
        contentType: "application/problem+json",
        status: problem.status,
      })
    )
  )
);
