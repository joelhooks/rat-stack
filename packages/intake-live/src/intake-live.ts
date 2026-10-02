import type { ContactRef, IntakeEvents } from "@rat-stack/core/intake";
import { Layer } from "effect";
import type { Option, Redacted } from "effect";

import { hmacIntakeTicketLayer } from "./hmac-tickets.js";
import { doIntakeVault } from "./intake-vault.js";
import type { IntakeVaultStub } from "./intake-vault.js";
import { jevAbuseScoreLayer } from "./jev-abuse-score.js";
import { mirroredIntakeEventsLayer } from "./mirrored-intake-events.js";
import { sealedIntakeEventsLayer } from "./sealed-intake-events.js";
import { doTicketBindings } from "./ticket-bindings.js";
import type { TicketBindingStub } from "./ticket-bindings.js";

export interface IntakeLiveSettings {
  readonly events?: Layer.Layer<IntakeEvents>;
  readonly interests: (name: string) => IntakeVaultStub & TicketBindingStub;
  readonly tokenSecret: Redacted.Redacted;
  readonly typesafeApiKey: Option.Option<Redacted.Redacted>;
}

export const ticketInstance = (nonce: string) => `ticket:${nonce}`;

export const intakeInstance = (actor: ContactRef) => `intake:${actor}`;

export const intakeLiveLayer = (settings: IntakeLiveSettings) => {
  const vault = sealedIntakeEventsLayer.pipe(
    Layer.provide(
      doIntakeVault((actor) => settings.interests(intakeInstance(actor)))
    )
  );

  return Layer.mergeAll(
    hmacIntakeTicketLayer(settings.tokenSecret).pipe(
      Layer.provide(
        doTicketBindings((nonce) => settings.interests(ticketInstance(nonce)))
      )
    ),
    settings.events === undefined
      ? vault
      : mirroredIntakeEventsLayer(vault, settings.events),
    jevAbuseScoreLayer({ apiKey: settings.typesafeApiKey })
  );
};
