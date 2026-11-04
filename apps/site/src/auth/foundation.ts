import { D1Vendor } from "@rat-stack/database/d1";
import { Random } from "alchemy";
import * as Namespace from "alchemy/Namespace";
import { retain } from "alchemy/RemovalPolicy";
import { Stage } from "alchemy/Stage";
import { Effect, Layer } from "effect";
import { identity } from "effect/Function";

const retainInProd =
  globalThis.__ALCHEMY_RUNTIME__ === true
    ? identity
    : retain(Stage.pipe(Effect.map((stage) => stage === "prod")));

export const feedbackFoundation = Effect.gen(function* feedbackFoundation() {
  const database = yield* Layer.build(D1Vendor({ id: "LearnFeedback" })).pipe(
    retainInProd
  );

  const secret = yield* Random("LearnFeedbackSecret").pipe(retainInProd);

  return { database, secret };
}).pipe(Namespace.set("LearnFeedbackAuth"));
