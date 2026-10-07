import {
  learnCardContract,
  learnDeckContract,
  learnNextContract,
  learnRecordContract,
} from "@rat-stack/core/contracts";
import { Effect, Schema } from "effect";

export const linkedSourceSchema = Schema.Struct({
  accessed: Schema.String,
  kind: Schema.Literal("linked").pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("linked"))
  ),
  note: Schema.String,
  publisher: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export const recordingSourceSchema = Schema.Struct({
  kind: Schema.Literal("recording"),
  note: Schema.String,
  recordedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  title: Schema.String,
});

export const bibliographySourceSchema = Schema.Union([
  linkedSourceSchema,
  recordingSourceSchema,
]);

export type BibliographySource = typeof bibliographySourceSchema.Type;

export interface CopyPromptSpec {
  readonly agentFence: boolean;
  readonly label: string;
  readonly showText: boolean;
  readonly showLabel?: boolean;
  readonly text: string;
  readonly variant?: "primary" | "text";
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
  learn: {
    agentFence: true,
    label: "Copy prompt",
    showText: true,
    text: [
      "Turn on rat-stack learn mode for me.",
      `1. Connect to the rat-stack MCP server at https://ratstack.sh/mcp. Use ${learnDeckContract.name} and ${learnCardContract.name} to read the public concept deck.`,
      "2. Install the rat-stack skills with npx skills add joelhooks/rat-stack, then follow https://ratstack.sh/skills/learn.",
      `3. Keep my progress local in ~/.rat-learn/. Use the local ${learnNextContract.name} and ${learnRecordContract.name} tools from a rat-stack checkout, as the skill says.`,
      "4. Never send my code, file paths, names, repository names, or prompts.",
      "5. Ask me to confirm before you start. Keep questions off unless I turn them on. Stop when I say learn mode off.",
    ].join("\n"),
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
      "Read https://ratstack.sh/tokenmaxx as markdown.",
      "Draft my application for the workshop from what you know about me and my work.",
      "Make the case for whether I fit, push me on anything vague, then show me what you'll send.",
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
