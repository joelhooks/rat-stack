import * as Cloudflare from "@alchemy.run/cloudflare";

export const ratstackStateStoreName =
  "alchemy-state-store-ratstack-state-store";

export const ratstackState = (state = Cloudflare.state) =>
  state({ workerName: ratstackStateStoreName });
