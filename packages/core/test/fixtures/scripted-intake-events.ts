import { Effect, Layer, Ref } from "effect";

import { IntakeEvents } from "../../src/intake-events.js";
import type { ContactRef } from "../../src/intake-events.js";

type Events = IntakeEvents["Service"];

export const makeScriptedIntakeEvents = Effect.fnUntraced(
  function* makeScriptedIntakeEvents({ erase, record }: Partial<Events> = {}) {
    const erased = yield* Ref.make<readonly ContactRef[]>([]);

    const recorded = yield* Ref.make<readonly Parameters<Events["record"]>[]>(
      []
    );

    const layer = Layer.succeed(IntakeEvents, {
      erase: (actor) =>
        Ref.update(erased, (all) => [...all, actor]).pipe(
          Effect.flatMap(
            () => erase?.(actor) ?? Effect.die("Unexpected intake erasure")
          )
        ),
      record: (...args) =>
        Ref.update(recorded, (all) => [...all, args]).pipe(
          Effect.flatMap(
            () =>
              record?.(...args) ??
              Effect.die("Unexpected intake event recording")
          )
        ),
    });

    return {
      eraseCalls: Ref.get(erased),
      recordCalls: Ref.get(recorded),
      layer,
    };
  }
);

export const scriptedIntakeEventsLayer = (script?: Partial<Events>) =>
  Layer.unwrap(
    Effect.map(makeScriptedIntakeEvents(script), (events) => events.layer)
  );
