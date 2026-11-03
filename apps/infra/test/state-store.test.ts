import * as Cloudflare from "@alchemy.run/cloudflare";
import { expect, it } from "@effect/vitest";

import { ratstackState } from "../src/state-store.js";

it("asks Alchemy for the Worker that beta.84 named ratstack-state-store", () => {
  const requested: Parameters<typeof Cloudflare.state>[0][] = [];

  ratstackState((options) => {
    requested.push(options);

    return Cloudflare.state(options);
  });

  expect(requested).toEqual([
    { workerName: "alchemy-state-store-ratstack-state-store" },
  ]);
});
