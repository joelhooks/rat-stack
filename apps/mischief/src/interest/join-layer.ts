import type {
  AbuseScore,
  IntakeEvents,
  IntakeTicket,
} from "@rat-stack/core/intake";
import type {
  InterestTokens,
  SubscriberIntake,
} from "@rat-stack/core/interest";
import { joinIntakeLayer } from "@rat-stack/core/join-interest";
import type { Context } from "effect";
import { Crypto, Effect, Layer } from "effect";

import { joinContactStoreLayer } from "./join-contact-store.js";
import type { JoinContactStub } from "./join-contact-store.js";

const workerCryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    digest: (algorithm, data) =>
      Effect.promise(
        crypto.subtle.digest.bind(
          crypto.subtle,
          algorithm,
          new Uint8Array(data)
        )
      ).pipe(Effect.map((buffer) => new Uint8Array(buffer))),
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
  })
);

export interface AgentSignupOptions {
  readonly intake: Layer.Layer<IntakeTicket | AbuseScore | IntakeEvents>;
  readonly contacts: (submissionId: string) => JoinContactStub;
}

export const agentSignupLayer = (
  options: AgentSignupOptions,
  services: Context.Context<InterestTokens | SubscriberIntake>
) =>
  joinIntakeLayer.pipe(
    Layer.provideMerge(
      joinContactStoreLayer(options.contacts).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            options.intake,
            Layer.succeedContext(services),
            workerCryptoLayer
          )
        )
      )
    )
  );
