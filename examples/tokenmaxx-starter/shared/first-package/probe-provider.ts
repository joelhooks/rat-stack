import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Loaded with `-e` by the done check's probe only, never by a guest's Pi. It
// adds one model, `probe/probe`, served by the check's own fake endpoint on
// 127.0.0.1 (./probe.ts), so a fresh Pi sends its first request there instead
// of to a real provider: no model, no login, no tokens. It registers no tool
// and no skill, so it can't change what the check counts.

export default function probeProvider(pi: ExtensionAPI) {
  const baseUrl = process.env["TMX_PROBE_URL"];
  if (baseUrl === undefined || baseUrl === "") {
    return;
  }
  pi.registerProvider("probe", {
    baseUrl,
    apiKey: "probe",
    api: "openai-completions",
    models: [
      {
        id: "probe",
        name: "probe",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 1024,
      },
    ],
  });
}
