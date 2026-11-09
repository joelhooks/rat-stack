import type { BetterAuthPlugin } from "better-auth";
import { deviceAuthorization } from "better-auth/plugins";

import { feedbackClientId } from "./feedback-constants.js";

export { feedbackClientId, feedbackScope } from "./feedback-constants.js";

const devicePlugin = deviceAuthorization({
  schema: {},
  validateClient: (clientId) => clientId === feedbackClientId,
  verificationUri: "/learn/approve",
});

const columnUniqueDeviceSchema = {
  deviceCode: {
    fields: {
      ...devicePlugin.schema.deviceCode.fields,
      deviceCode: {
        ...devicePlugin.schema.deviceCode.fields.deviceCode,
        unique: true,
      },
      userCode: {
        ...devicePlugin.schema.deviceCode.fields.userCode,
        unique: true,
      },
    },
    indexes: [],
  },
};

export const feedbackDevicePlugin: ReturnType<typeof deviceAuthorization> = {
  ...devicePlugin,
  schema: columnUniqueDeviceSchema,
};

export const feedbackStoragePlugin = {
  id: "learn-feedback-storage",
  schema: {
    learnFeedback: {
      fields: {
        cardId: { required: true, type: "string" },
        createdAt: { required: true, type: "date" },
        feedback: { required: true, type: "string" },
        personId: {
          references: { field: "id", model: "user", onDelete: "cascade" },
          required: true,
          type: "string",
        },
      },
    },
  },
} satisfies BetterAuthPlugin;
