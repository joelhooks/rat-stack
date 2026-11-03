import { Effect } from "effect";

export const loadInterestPages = Effect.promise(
  () => import("../interest-pages.generated.js")
);
