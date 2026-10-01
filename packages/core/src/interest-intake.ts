import { Context } from "effect";
import type { Effect } from "effect";

export interface IntakeRequest {
  readonly challenge: string;
  readonly clientBucket: {
    readonly ipHash: string;
    readonly uaHash: string;
  };
  readonly email: string;
  readonly submissionId: string;
}

export type IntakeResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "refused" }
  | { readonly kind: "retry"; readonly afterSeconds: number };

export class SubscriberIntake extends Context.Service<
  SubscriberIntake,
  { readonly submit: (request: IntakeRequest) => Effect.Effect<IntakeResult> }
>()("@rat-stack/core/SubscriberIntake") {}
