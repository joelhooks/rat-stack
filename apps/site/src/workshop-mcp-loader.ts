import {
  SetupHelpAccess,
  SetupHelpDesk,
  SetupHelpGuide,
} from "@rat-stack/core/tokenmaxx-help";
import { WorkshopDirectory } from "@rat-stack/core/workshop-directory";
import { Context, Effect, Layer } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpRouter from "effect/http/HttpRouter";

const loadWorkshopMcpRuntime = Effect.promise(
  () => import("./workshop-mcp-runtime.js")
);

export const lazyWorkshopMcpHandler = Effect.gen(
  function* lazyWorkshopMcpHandler() {
    const scope = yield* Effect.scope;
    const directory = yield* WorkshopDirectory;

    const help = Layer.mergeAll(
      Layer.succeed(SetupHelpAccess, yield* SetupHelpAccess),
      Layer.succeed(SetupHelpDesk, yield* SetupHelpDesk),
      Layer.succeed(SetupHelpGuide, yield* SetupHelpGuide),
      Layer.succeed(SecureRandom.SecureRandom, yield* SecureRandom.SecureRandom)
    );

    const memoMap = yield* Layer.makeMemoMap;

    // oxlint-disable-next-line rat-stack-patterns/no-shared-pending-cache -- The router scope owns one lazy module and sub-router build over captured services, with no request-bound I/O.
    return yield* Effect.cached(
      loadWorkshopMcpRuntime.pipe(
        Effect.flatMap(({ workshopMcpRoutes }) =>
          Layer.buildWithMemoMap(
            Layer.provideMerge(
              workshopMcpRoutes.pipe(
                Layer.provide(Layer.succeed(WorkshopDirectory, directory)),
                Layer.provide(help)
              ),
              HttpRouter.layer
            ),
            memoMap,
            scope
          ).pipe(
            Effect.map((context) =>
              // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- HttpRouter declares an unknown error; the MCP transport renders request failures and router construction defects must propagate.
              Context.get(context, HttpRouter.HttpRouter)
                .asHttpEffect()
                .pipe(Effect.orDie)
            )
          )
        ),
        Effect.orDie
      )
    );
  }
);

export const workshopMcpForward = Effect.gen(function* workshopMcpForward() {
  const lazy = yield* lazyWorkshopMcpHandler;
  const fetch = yield* lazy;
  const handler = HttpEffect.toWebHandler(fetch);

  return (request: Request) => Effect.promise(() => handler(request));
});
