export type PlayerState =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "seeking"
  | "ended"
  | "unavailable"
  | "failed";

export interface PlayerSnapshot {
  readonly state: PlayerState;
  readonly currentMs: number;
  readonly durationMs: number | undefined;
  readonly rate: number;
  readonly seeking: boolean;
}

export interface PlayerController {
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (ms: number) => void;
  readonly setRate: (rate: number) => void;
  readonly getSnapshot: () => PlayerSnapshot;
  readonly subscribe: (
    listener: (snapshot: PlayerSnapshot) => void
  ) => () => void;
}
