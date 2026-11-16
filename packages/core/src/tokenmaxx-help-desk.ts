import { Context } from "effect";
import type { Effect } from "effect";

import type {
  HelpFileOutcome,
  HelpListQuery,
  HelpLookup,
  HelpPage,
  NewHelpReport,
} from "./tokenmaxx-help-store.js";
import type { HelpUnavailable } from "./tokenmaxx-help-unavailable.js";

export class SetupHelpDesk extends Context.Service<
  SetupHelpDesk,
  {
    readonly answer: (
      reportId: string,
      answer: string
    ) => Effect.Effect<typeof HelpLookup.Type, HelpUnavailable>;
    readonly file: (
      report: typeof NewHelpReport.Type
    ) => Effect.Effect<typeof HelpFileOutcome.Type, HelpUnavailable>;
    readonly find: (
      reportId: string
    ) => Effect.Effect<typeof HelpLookup.Type, HelpUnavailable>;
    readonly list: (
      query: typeof HelpListQuery.Type
    ) => Effect.Effect<typeof HelpPage.Type, HelpUnavailable>;
  }
>()("rat-stack/SetupHelpDesk") {}
