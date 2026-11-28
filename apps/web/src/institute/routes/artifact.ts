import { Effect } from "effect";

import { InstituteAssetError, InstituteContent } from "../content/index.js";

export type AssetFetch = (request: Request) => Promise<Response>;

export const instituteContentLayer = (fetchAsset: AssetFetch, origin: string) =>
  InstituteContent.layer((path) => {
    const failed = (cause: unknown) => new InstituteAssetError({ cause, path });

    return Effect.gen(function* readWebsiteAsset() {
      const response = yield* Effect.tryPromise({
        catch: failed,
        try: () => fetchAsset(new Request(new URL(path, origin))),
      });

      if (!response.ok) {
        return yield* failed(response.status);
      }

      return yield* Effect.tryPromise({
        catch: failed,
        try: () => response.text(),
      });
    });
  });
