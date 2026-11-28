import { Effect, Fiber, Schema } from "effect";

class CueUnavailable extends Schema.TaggedError<
  CueUnavailable,
  { readonly brand: unique symbol }
>()("CueUnavailable", { cause: Schema.Defect() }) {}

const tickEnvelope = { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 };

const presets = {
  click: { hz: 783.991, beats: 1 / 8, velocity: 0.25, envelope: tickEnvelope },
  skip: { hz: 1046.502, beats: 1 / 16, velocity: 0.09, envelope: tickEnvelope },
  complete: {
    hz: 523.251,
    beats: 1,
    velocity: 0.4,
    envelope: { attack: 0.02, decay: 0.5, sustain: 0.1, release: 0.4 },
  },
} as const;

type Cue = keyof typeof presets;

const playCue = (output: GainNode, cue: Cue) => {
  const ctx = output.context;

  const {
    hz,
    beats,
    velocity,
    envelope: { attack, decay, sustain, release },
  } = presets[cue];

  const start = ctx.currentTime;
  const attackEnd = start + attack;
  const noteOff = start + beats * 0.5;
  const decayConstant = decay / Math.log(1000);
  const sustainGain = velocity * sustain;

  const offGain =
    sustainGain +
    (velocity - sustainGain) * Math.exp(-(noteOff - attackEnd) / decayConstant);

  const oscillator = new OscillatorNode(ctx, { type: "sine", frequency: hz });
  const amp = new GainNode(ctx, { gain: 0 });

  const filters =
    cue === "complete"
      ? [
          new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1200, Q: 1 }),
          new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1200, Q: 1 }),
        ]
      : [];

  oscillator.connect(amp);
  let upstream: AudioNode = amp;

  for (const filter of filters) {
    upstream.connect(filter);
    upstream = filter;
  }

  upstream.connect(output);
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(velocity, attackEnd);
  amp.gain.setTargetAtTime(sustainGain, attackEnd, decayConstant);
  amp.gain.setValueAtTime(offGain, noteOff);
  amp.gain.setTargetAtTime(0, noteOff, release / Math.log(1000));
  oscillator.addEventListener(
    "ended",
    () => {
      oscillator.disconnect();
      amp.disconnect();

      for (const filter of filters) {
        filter.disconnect();
      }
    },
    { once: true }
  );
  oscillator.start(start);
  oscillator.stop(noteOff + release);
};

const resume = (ctx: AudioContext) =>
  Effect.tryPromise({
    try: () => ctx.resume(),
    catch: (cause) => new CueUnavailable({ cause }),
  });

export const createCueBank = (doc: Document, muted: () => boolean) => {
  let audio: AudioContext | undefined;
  let output: GainNode | undefined;
  let pending: Fiber.Fiber<void, CueUnavailable> | undefined;
  let lastClickMs = Number.NEGATIVE_INFINITY;

  return {
    unlock: () => {
      const browser = doc.defaultView;

      if (muted() || browser?.AudioContext === undefined) {
        return;
      }

      if (audio === undefined) {
        try {
          const ctx = new browser.AudioContext();
          output = ctx.createGain();
          output.connect(ctx.destination);
          audio = ctx;
        } catch {
          return;
        }
      }

      if (audio.state === "suspended" && pending === undefined) {
        pending = Effect.runFork(resume(audio));
      }
    },
    setMuted: (value: boolean) => {
      if (output !== undefined) {
        output.gain.value = value ? 0 : 1;
      }
    },
    play: (cue: Cue) => {
      if (output === undefined || muted()) {
        return;
      }

      const now = output.context.currentTime * 1000;

      if (cue === "click" && now - lastClickMs < 150) {
        return;
      }

      if (cue === "click") {
        lastClickMs = now;
      }

      const trigger = Effect.sync(() => {
        if (output !== undefined && !muted()) {
          playCue(output, cue);
        }
      });

      Effect.runFork(
        (pending === undefined
          ? trigger
          : Fiber.join(pending).pipe(Effect.andThen(trigger))
        ).pipe(Effect.ignore)
      );
    },
    dispose: () => {
      const ctx = audio;
      const resumeFiber = pending;
      output?.disconnect();
      output = undefined;

      if (ctx !== undefined) {
        const close = Effect.tryPromise({
          try: () => ctx.close(),
          catch: (cause) => new CueUnavailable({ cause }),
        });

        Effect.runFork(
          resumeFiber === undefined
            ? Effect.ignore(close)
            : Fiber.interrupt(resumeFiber).pipe(
                Effect.andThen(Effect.ignore(close))
              )
        );
      }
    },
  };
};
