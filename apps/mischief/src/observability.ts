import type { WorkerObservability } from "alchemy/Cloudflare/Workers";

export const privateObservability = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true },
  traces: { enabled: false },
} satisfies WorkerObservability;
