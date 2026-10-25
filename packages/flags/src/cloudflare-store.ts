import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Namespace from "alchemy/Namespace";
import { retain } from "alchemy/RemovalPolicy";

export const flagsNamespace = Cloudflare.KV.Namespace("Store").pipe(
  retain(),
  Namespace.set("FeatureFlags")
);
