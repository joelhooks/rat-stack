import { D1Vendor } from "@rat-stack/database/d1";
import { Random } from "alchemy";
import * as Namespace from "alchemy/Namespace";
import { retain } from "alchemy/RemovalPolicy";
import { Effect, Layer } from "effect";

export const feedbackFoundation = Effect.gen(function* feedbackFoundation() {
  const database = yield* Layer.build(D1Vendor({ id: "LearnFeedback" })).pipe(
    retain()
  );

  const secret = yield* Random("LearnFeedbackSecret").pipe(retain());

  return { database, secret };
}).pipe(Namespace.set("LearnFeedbackAuth"));
