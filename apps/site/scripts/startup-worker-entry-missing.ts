import { Schema } from "effect";

export class StartupWorkerEntryMissing extends Schema.TaggedError<
  StartupWorkerEntryMissing,
  { readonly brand: unique symbol }
>()("StartupWorkerEntryMissing", {
  entry: Schema.String,
  worker: Schema.String,
}) {
  override get message() {
    const fix =
      this.worker === "TurboCache"
        ? "remove the `TurboCache` entry from `apps/site/scripts/startup-budget.ts`"
        : `restore \`${this.entry}\` before running \`pnpm --filter @rat-stack/site startup:check\``;

    return `${this.worker} Worker entry is missing. A missing entry prevents measuring its startup ceiling. Fix: ${fix}.`;
  }
}
