import type { BetterAuthPlugin } from "better-auth";
import { deviceAuthorization } from "better-auth/plugins";

export const feedbackClientId = "rat-stack-learn-feedback";

export const feedbackScope = "learn:feedback";

const devicePlugin = deviceAuthorization({
  schema: {},
  validateClient: (clientId) => clientId === feedbackClientId,
  verificationUri: "/learn/approve",
});

const indexedDeviceSchema = {
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
  },
};

export const feedbackDevicePlugin: ReturnType<typeof deviceAuthorization> = {
  ...devicePlugin,
  schema: indexedDeviceSchema,
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
