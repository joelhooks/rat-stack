import { Effect, Layer } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

export class Maintenance extends HttpApiMiddleware.Service<Maintenance>()(
  "@rat-stack/capability/test/Maintenance"
) {}

export const MaintenanceLayer = Layer.succeed(Maintenance, () =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe({ maintenance: true }, { status: 503 })
  )
);
