import type { BetterAuthInstance } from "@alchemy.run/better-auth";

import {
  feedbackDevicePlugin,
  feedbackStoragePlugin,
} from "./feedback-plugin.js";

interface AuthOptions {
  readonly basePath: "/auth";
  readonly emailAndPassword: { readonly enabled: true };
  readonly disabledPaths: string[];
  readonly plugins: [typeof feedbackDevicePlugin, typeof feedbackStoragePlugin];
}

export const authOptions: AuthOptions = {
  basePath: "/auth",
  disabledPaths: ["/device/token", "/device/code"],
  emailAndPassword: { enabled: true },
  plugins: [feedbackDevicePlugin, feedbackStoragePlugin],
};

export type AuthInstance = BetterAuthInstance<typeof authOptions>;
