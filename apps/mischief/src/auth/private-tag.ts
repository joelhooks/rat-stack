import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { HttpEffect } from "alchemy/Http";

import { privateObservability } from "../observability.js";
import { feedbackAuthBuild } from "./build-options.js";

export const feedbackAuthDeployment = {
  build: feedbackAuthBuild,
  observability: privateObservability,
  workersDev: false,
};

export class LearnFeedbackAuth extends Cloudflare.Worker<
  LearnFeedbackAuth,
  { readonly fetch: HttpEffect<RuntimeContext> }
>()("LearnFeedbackAuth") {}
