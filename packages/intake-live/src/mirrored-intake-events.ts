import { IntakeEvents } from "@rat-stack/core/intake";
import { Context, Effect, Layer } from "effect";

export const mirrorIntakeEvents = (
  primary: IntakeEvents["Service"],
  mirror: IntakeEvents["Service"]
): IntakeEvents["Service"] => ({
  erase: (actor) => Effect.andThen(mirror.erase(actor), primary.erase(actor)),
  record: (statements, contact) =>
    Effect.andThen(
      primary.record(statements, contact),
      mirror
        .record(statements, contact)
        .pipe(
          Effect.catchTag("IntakeEventsUnavailable", () =>
            Effect.logWarning("intake mirror unavailable; backfill repairs it")
          )
        )
    ),
});

export const mirroredIntakeEventsLayer = (
  primary: Layer.Layer<IntakeEvents>,
  mirror: Layer.Layer<IntakeEvents>
) =>
  Layer.effect(
    IntakeEvents,
    Effect.gen(function* buildMirroredIntakeEvents() {
      const primaryEvents = Context.get(
        yield* Layer.build(primary),
        IntakeEvents
      );

      const mirrorEvents = Context.get(
        yield* Layer.build(mirror),
        IntakeEvents
      );

      return mirrorIntakeEvents(primaryEvents, mirrorEvents);
    })
  );
