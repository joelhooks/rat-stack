import { Match, Option, Schema } from "effect";

export const rates = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export const Rate = Schema.Literals(rates);

export const decodeRate = Schema.decodeUnknownOption(Rate);

export const PlaybackSchema = Schema.Struct({
  state: Schema.Literals([
    "loading",
    "ready",
    "playing",
    "paused",
    "seeking",
    "ended",
    "unavailable",
    "failed",
  ]),
  currentMs: Schema.Finite,
  durationMs: Schema.UndefinedOr(Schema.Finite),
  rate: Schema.Finite,
  seeking: Schema.Boolean,
});

export type Playback = typeof PlaybackSchema.Type;

export interface ControlsTransport {
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (ms: number) => void;
  readonly setRate: (rate: number) => void;
  readonly getSnapshot: () => Playback;
  readonly subscribe: (listener: (snapshot: Playback) => void) => () => void;
}

export const TransportAction = Schema.TaggedUnion({
  Toggle: {},
  Replay: {},
  Seek: { ms: Schema.Finite },
  SeekBy: { ms: Schema.Finite },
  Rate: { rate: Rate },
  StepRate: { direction: Schema.Literals([-1, 1]) },
});

export const ControlsActionSchema = Schema.Union([
  TransportAction,
  Schema.TaggedStruct("Mute", {}),
]);

export type ControlsAction = typeof ControlsActionSchema.Type;

export const muteAction = Schema.TaggedStruct("Mute", {});

export const hasTransport = ({ state }: Playback) =>
  state !== "failed" && state !== "unavailable" && state !== "loading";

export const seekTo = (transport: ControlsTransport, positionMs: number) => {
  const snapshot = transport.getSnapshot();

  if (
    hasTransport(snapshot) &&
    snapshot.durationMs !== undefined &&
    Number.isFinite(positionMs)
  ) {
    transport.seek(Math.max(0, Math.min(positionMs, snapshot.durationMs)));
  }
};

export const applyTransportAction = (
  transport: ControlsTransport,
  action: typeof TransportAction.Type
) => {
  const snapshot = transport.getSnapshot();

  if (!hasTransport(snapshot)) {
    return;
  }

  const execute = Match.value(action).pipe(
    Match.tagsExhaustive({
      Toggle: () => () => {
        if (snapshot.state === "playing") {
          transport.pause();
        } else {
          transport.play();
        }
      },
      Replay: () => () => {
        seekTo(transport, 0);
        transport.play();
      },
      Seek:
        ({ ms }) =>
        () => {
          seekTo(transport, ms);
        },
      SeekBy:
        ({ ms }) =>
        () => {
          seekTo(transport, snapshot.currentMs + ms * snapshot.rate);
        },
      Rate:
        ({ rate }) =>
        () => {
          transport.setRate(rate);
        },
      StepRate:
        ({ direction }) =>
        () => {
          const current = decodeRate(snapshot.rate);

          if (Option.isSome(current)) {
            const rate = rates[rates.indexOf(current.value) + direction];

            if (rate !== undefined) {
              transport.setRate(rate);
            }
          }
        },
    })
  );

  execute();
};
