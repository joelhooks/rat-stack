import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Namespace from "alchemy/Namespace";
import { retain } from "alchemy/RemovalPolicy";
import { Stage } from "alchemy/Stage";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";

const retainInProd =
  globalThis.__ALCHEMY_RUNTIME__ === true
    ? identity
    : retain(Stage.pipe(Effect.map((stage) => stage === "prod")));

export const flagsNamespace = Cloudflare.KV.Namespace("Store").pipe(
  retainInProd,
  Namespace.set("FeatureFlags")
);
