import RpcBackend from "@rat-stack/mischief/rpc-worker";
import * as Cloudflare from "alchemy/Cloudflare";

import { privateObservability } from "../../mischief/src/observability.js";

export class Website extends Cloudflare.Website.Vite<Website>()("Website", {
  env: { BACKEND: RpcBackend },
  observability: privateObservability,
  rootDir: "../web",
}) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
