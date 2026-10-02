import { Schema } from "effect";

export const bibliographySourceSchema = Schema.Struct({
  accessed: Schema.String,
  note: Schema.String,
  publisher: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export type BibliographySource = typeof bibliographySourceSchema.Type;

export interface CopyPromptSpec {
  readonly agentFence: boolean;
  readonly label: string;
  readonly showText: boolean;
  readonly showLabel?: boolean;
  readonly text: string;
  readonly variant?: "primary";
}

export const copyPrompts = {
  connect: {
    agentFence: false,
    label: "Copy prompt",
    showLabel: true,
    showText: false,
    text: [
      "Read __RATSTACK_ORIGIN__/llms.txt and use rat-stack as the reference",
      "for how we build: Effect for the hard parts, Alchemy for the",
      "infrastructure, and a fence that makes the easy path the right",
      "one. Search its rules and skills before you write code, follow",
      "its patterns, and tell me when my code breaks them.",
    ].join("\n"),
  },
  cursor: {
    agentFence: false,
    label: "Copy",
    showLabel: true,
    showText: false,
    text: '{ "mcpServers": { "rat-stack": { "url": "__RATSTACK_ORIGIN__/mcp" } } }',
  },
  mcp: {
    agentFence: false,
    label: "Copy",
    showLabel: true,
    showText: false,
    text: "# Claude Code\nclaude mcp add --transport http rat-stack __RATSTACK_ORIGIN__/mcp\n\n# Codex\ncodex mcp add rat-stack --url __RATSTACK_ORIGIN__/mcp",
  },
  page: {
    agentFence: false,
    label: "Copy prompt",
    showText: false,
    text: [
      "Read https://ratstack.sh/tokenmaxx as markdown and https://ratstack.sh/llms.txt.",
      'Explain the "how to burn a trillion tokens and get good results" workshop to me.',
      "Ask me the five application questions from the agent view of the page. Do not inspect my machine.",
      "Show me an editable card of exactly what you would send, including skipped fields and permissions. Submit only after I approve it.",
    ].join("\n"),
  },
  setup: {
    agentFence: true,
    label: "Copy prompt",
    showText: true,
    text: [
      'Check my setup for the "how to burn a trillion tokens and get good results" session.',
      "1. Check that Docker is running (Docker Desktop or OrbStack).",
      "2. Create a private repo from the joelhooks/rat-stack template and clone it: gh repo create my-factory --private --template joelhooks/rat-stack",
      "3. Read https://ratstack.sh/llms.txt",
      "4. Tell me what is missing.",
    ].join("\n"),
  },
  skills: {
    agentFence: false,
    label: "Copy",
    showLabel: true,
    showText: false,
    text: "npx skills add joelhooks/rat-stack",
  },
} satisfies Record<string, CopyPromptSpec>;
