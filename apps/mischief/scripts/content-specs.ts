export interface SourceSpec {
  readonly description: string;
  readonly routePath: `/${string}`;
  readonly sourcePath: string;
  readonly title: string;
}

export const lawSpecs: readonly SourceSpec[] = [
  {
    description:
      "What you may change, which commands to run, and which changes need approval.",
    routePath: "/AGENTS.md",
    sourcePath: "AGENTS.md",
    title: "Agent rules for rat-stack (AGENTS.md)",
  },
  {
    description: "What this starter is for and what a useful copy should keep.",
    routePath: "/VISION.md",
    sourcePath: "VISION.md",
    title: "Purpose and boundaries of rat-stack (VISION.md)",
  },
  {
    description:
      "What is in the repo, how the example works, and how to run it.",
    routePath: "/README.md",
    sourcePath: "README.md",
    title: "Build and run rat-stack (README.md)",
  },
  {
    description:
      "How to pin an unpublished package and when to remove the local copy.",
    routePath: "/vendor/README.md",
    sourcePath: "vendor/README.md",
    title: "Dependency vendoring rules (vendor/README.md)",
  },
  {
    description:
      "Dated Effect 4 source studies from September 2026; current versions live in pins.md.",
    routePath: "/resources/effect-4-reference-projects",
    sourcePath: ".brain/resources/effect-4-reference-projects.svx",
    title: "Effect 4 study: September 2026",
  },
  {
    description:
      "Historical Effect rc.115 proposal and implementation receipts from 2026-09-18; use the one-capability-every-surface lore page for the current pattern.",
    routePath: "/resources/schema-projections-and-code-mode",
    sourcePath: ".brain/resources/schema-projections-and-code-mode.svx",
    title: "Schema projections: 2026-09-18 history",
  },
  {
    description: "How the current lint rules draw their syntax boundaries.",
    routePath: "/resources/lint-rule-limits",
    sourcePath: ".brain/resources/lint-rule-limits.svx",
    title: "Oxlint rule limits",
  },
  {
    description: "Public repositories that share rat-stack's prerelease lines.",
    routePath: "/resources/peers",
    sourcePath: ".brain/resources/peers.svx",
    title: "Effect + Alchemy peers",
  },
  {
    description:
      "Source-grounded patterns from repos on nearby Effect and Alchemy pins.",
    routePath: "/resources/same-version-repos",
    sourcePath: ".brain/resources/same-version-repos.svx",
    title: "Effect + Alchemy peer patterns",
  },
];
