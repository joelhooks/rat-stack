import type { WorkerObservability } from "alchemy/Cloudflare/Workers";

export const privateObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: false },
  traces: { enabled: false },
} satisfies WorkerObservability;

export const silentObservability = {
  ...privateObservability,
  enabled: false,
  logs: { enabled: false, invocationLogs: false },
} satisfies WorkerObservability;
