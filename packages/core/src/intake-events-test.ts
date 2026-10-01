import { Context } from "effect";
import type { Effect } from "effect";

import type { ContactRef, IntakeStatement } from "./intake-events.js";

export class IntakeEventsTest extends Context.Service<
  IntakeEventsTest,
  {
    readonly erased: Effect.Effect<readonly ContactRef[]>;
    readonly statements: Effect.Effect<readonly IntakeStatement[]>;
  }
>()("@rat-stack/core/IntakeEventsTest") {}
