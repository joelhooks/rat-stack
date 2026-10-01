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

export interface AgentIntakeRequest {
  readonly email: string;
  readonly submissionId: string;
  readonly source: "agent";
  readonly agentRef: string;
  readonly ticket?: string;
  readonly score?: number;
  readonly hold?: boolean;
  readonly signals?: readonly string[];
  readonly clientBucket: IntakeRequest["clientBucket"];
}

export interface AgentIntake {
  readonly enabled: boolean;
  readonly submit: (request: AgentIntakeRequest) => Effect.Effect<IntakeResult>;
}

export type IntakeResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "refused" }
  | { readonly kind: "retry"; readonly afterSeconds: number };

export class SubscriberIntake extends Context.Service<
  SubscriberIntake,
  {
    readonly submit: (request: IntakeRequest) => Effect.Effect<IntakeResult>;
    readonly agent?: AgentIntake;
  }
>()("@rat-stack/core/SubscriberIntake") {}
