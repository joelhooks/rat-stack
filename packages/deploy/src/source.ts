import { Schema } from "effect";

export const CommitShaSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u)
).annotate({
  description:
    "Full 40-character commit SHA the checkout must be at, with a clean tree",
});

export const CheckoutStateSchema = Schema.Struct({
  changed: Schema.Array(Schema.String),
  head: Schema.String,
});

export type CheckoutState = typeof CheckoutStateSchema.Type;

export type SourceDecision =
  | { readonly kind: "match" }
  | {
      readonly kind: "refused";
      readonly reason:
        | "checkout-head-does-not-match-expected-sha"
        | "checkout-has-uncommitted-changes";
    };

export const decideSource = (
  expected: string,
  checkout: CheckoutState
): SourceDecision => {
  if (checkout.head.trim().toLowerCase() !== expected) {
    return {
      kind: "refused",
      reason: "checkout-head-does-not-match-expected-sha",
    };
  }

  return checkout.changed.length === 0
    ? { kind: "match" }
    : { kind: "refused", reason: "checkout-has-uncommitted-changes" };
};
