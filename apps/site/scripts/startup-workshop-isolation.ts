import { Effect, Schema } from "effect";

export class WorkshopBundleLeak extends Schema.TaggedError<
  WorkshopBundleLeak,
  { readonly brand: unique symbol }
>()("WorkshopBundleLeak", { modules: Schema.Array(Schema.String) }) {
  override get message() {
    return `Workshop modules reached Mischief: ${this.modules.join(", ")}. Workshop capabilities belong to their isolated Worker, not the main site's static or dynamic graph. Fix: remove the import from Mischief and register it only in \`apps/site/src/workshop-runtime.ts\`.`;
  }
}

export const assertWorkshopIsolation = (modules: readonly string[]) => {
  const workshop = modules.filter((path) =>
    /(?:^|\/)(?:tokenmaxx-workshop[^/]*|workshop-(?:contracts|directory|handlers|runtime|worker))\.(?:js|ts)$/u.test(
      path
    )
  );

  return workshop.length === 0
    ? Effect.void
    : Effect.fail(new WorkshopBundleLeak({ modules: workshop }));
};
