import { definePlugin } from "@oxlint/plugins";

import { noFixedSleep } from "./rules/no-fixed-sleep.ts";
import { noFlakeMasking } from "./rules/no-flake-masking.ts";
import { noUnsignaledPoll } from "./rules/no-unsignaled-poll.ts";

export default definePlugin({
  meta: { name: "landmines" },
  rules: {
    "no-fixed-sleep": noFixedSleep,
    "no-flake-masking": noFlakeMasking,
    "no-flake-masking-timeout": noFlakeMasking,
    "no-unsignaled-poll": noUnsignaledPoll,
  },
});
