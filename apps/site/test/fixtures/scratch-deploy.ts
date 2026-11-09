import type * as Test from "@alchemy.run/test/Vitest";
import { Effect } from "effect";

export const deployScratch = <A, E, R>(
  stack: Test.ScratchStack,
  worker: Effect.Effect<A, E, R>
) =>
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy's ScratchStack erases provider errors; orDie closes this local runtime boundary for every scratch deploy.
  stack.deploy(worker).pipe(Effect.orDie);
