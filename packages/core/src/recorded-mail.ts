import { Context } from "effect";
import type { Effect } from "effect";

import type { InterestMail } from "./interest-mailer.js";

export class RecordedMail extends Context.Service<
  RecordedMail,
  { readonly all: Effect.Effect<readonly InterestMail[]> }
>()("@rat-stack/core/RecordedMail") {}
