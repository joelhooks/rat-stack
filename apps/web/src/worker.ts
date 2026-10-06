import { backend } from "#backend";

import { websiteHandler } from "./server/handler.js";
import type { BackendFetch } from "./server/rpc.js";

export default {
  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare's fetch entry requires a Promise response.
  fetch: async (
    request: Request,
    env: {
      readonly ASSETS: { readonly fetch: BackendFetch };
      readonly PREVIEW_COMMIT?: string;
    }
  ) =>
    await websiteHandler(
      backend,
      env.ASSETS.fetch.bind(env.ASSETS),
      env.PREVIEW_COMMIT
    )(request),
};
