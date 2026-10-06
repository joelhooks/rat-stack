import RpcBackend from "@rat-stack/mischief/rpc-worker";
import * as Cloudflare from "alchemy/Cloudflare";

import { privateObservability } from "../../mischief/src/observability.js";

export class Website extends Cloudflare.Website.Foldkit<Website>()("Website", {
  assets: { runWorkerFirst: ["/rpc", "/rpc/*", "/__rat", "/__rat/*"] },
  env: { BACKEND: RpcBackend },
  main: "src/worker.ts",
  observability: privateObservability,
  rootDir: "../web",
}) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
