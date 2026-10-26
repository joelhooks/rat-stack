import type { Effect } from "effect";

import type { IdentityMode } from "./event-sink.js";

export interface RequestCaptureSettings<RB> {
  readonly captureCity?: boolean;
  readonly identityMode: IdentityMode;
  readonly runInBackground: (
    effect: Effect.Effect<void>
  ) => Effect.Effect<void, never, RB>;
}

export interface EventsOptions {
  readonly enabled: boolean;
  readonly id: string;
}
