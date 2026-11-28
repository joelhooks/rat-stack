import { instituteOriginal } from "./paths.js";

const originalChapter = (chapter: string) =>
  `${instituteOriginal}/chapters/${chapter}`;

export const effectChapters = [
  { href: originalChapter("intro"), title: "Introduction to Effect" },
  { href: originalChapter("basics"), title: "Effect Basics" },
];

const lesson = (chapter: string, section: string, title: string) => ({
  href: `${originalChapter(chapter)}?${new URLSearchParams({ section })}`,
  title,
});

const showsErrors = lesson(
  "intro",
  "effect-shows-errors",
  "Effect shows errors"
);

const errorsCompose = lesson("intro", "errors-compose", "Errors compose");

const typesCaptureRuntime = lesson(
  "basics",
  "types-capture-runtime",
  "Types capture runtime"
);

const errorsShortCircuit = lesson(
  "basics",
  "errors-short-circuit",
  "Errors short circuit"
);

const effectIsADescription = lesson(
  "basics",
  "effect-is-a-description",
  "Effect is a description"
);

const runningEffects = lesson("basics", "running-effects", "Running Effects");

const effectGenSyntax = lesson(
  "basics",
  "effect-gen-syntax",
  "Effect gen syntax"
);

const structuredConcurrency = lesson(
  "intro",
  "effect-structured-concurrency",
  "Effect structured concurrency"
);

const prerequisites = new Map<string, readonly (typeof showsErrors)[]>([
  ["bind-behavior", [typesCaptureRuntime]],
  ["decode-a-match", [showsErrors, errorsCompose]],
  ["define-boundary", [showsErrors, typesCaptureRuntime]],
  ["follow-the-states", [structuredConcurrency]],
  ["from-read-to-cli", [runningEffects]],
  ["keep-the-schema", [typesCaptureRuntime]],
  ["name-the-job", [effectIsADescription]],
  ["people-surfaces", [showsErrors]],
  ["program-surfaces", [errorsCompose]],
  ["put-the-read-in-an-actor", [effectGenSyntax, structuredConcurrency]],
  ["say-how-to-fix-it", [showsErrors, errorsShortCircuit]],
  ["supply-an-adapter", [effectGenSyntax]],
]);

export const effectPrerequisites = (section: string) =>
  prerequisites.get(section) ?? [];
