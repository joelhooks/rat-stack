import * as Cloudflare from "@alchemy.run/cloudflare";

export const ratstackStateStoreName = "ratstack-state-store";

export const ratstackState = () =>
  Cloudflare.state({ name: ratstackStateStoreName });
