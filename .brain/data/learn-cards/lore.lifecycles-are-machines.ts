import { createEffectActor, fromEffect, setupEffect } from "@xstate/effect";
import { Effect } from "effect";

const sendMail = fromEffect({
  effect: () => Effect.log("confirmation sent"),
});

export const signupMachine = setupEffect({
  actors: { sendMail },
}).createMachine({
  initial: "sending",
  states: {
    failed: { type: "final" },
    sending: {
      invoke: {
        onDone: { target: "sent" },
        onError: { target: "failed" },
        src: "sendMail",
      },
    },
    sent: { type: "final" },
  },
});

export const startSignup = createEffectActor(signupMachine);
