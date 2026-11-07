export const cafeSubmissionGuide = (
  origin: string
) => `## Suggest a CAFE entry through your agent

Help the person you assist suggest a story for [news](${origin}/news) or a project for the [directory](${origin}/directory).

1. Check the page for an existing entry. You can also POST JSON to \`/api/listCafeNews\` or \`/api/listCafeProjects\`. Do not submit a duplicate.
2. Read the source repository and gather the fields below. Cite repository file paths for each stack claim. Do not invent evidence.
3. Draft the exact issue title and all fields. Say whether this is the person's own work. Show the person the draft, including any public attribution.
4. File only after the person approves that exact issue. Use the matching form in \`joelhooks/rat-stack\`.
5. Submit once. Do not spam or retry through another surface when the result is uncertain. Check GitHub for the issue first.

### Fields

- **News:** HTTPS URL, title and one-line summary (each at most 280 characters), kind (release, post, video or launch), optional repo (\`owner/repo\`), optional author GitHub login and X handle, and why it is CAFE.
- **Project:** HTTPS repo URL, title (at most 280 characters), one-line summary (at most 350 characters), and evidence for Cloudflare, Alchemy, Foldkit and Effect. Each evidence string names a file path and what it proves, in at most 280 characters. Write \`Not found\` for a letter without evidence.
- Disclose the person's connection to the entry in either form. Leave unknown optional fields blank.

### File the approved issue

Use \`gh issue create --repo joelhooks/rat-stack --template cafe-news.yml\` for a story, or \`gh issue create --repo joelhooks/rat-stack --template cafe-project.yml\` for a project. Use only the approved title and fields.

If gh is unavailable or cannot use issue forms, give the person the matching prefilled URL and the approved fields:

- News: \`https://github.com/joelhooks/rat-stack/issues/new?template=cafe-news.yml&title=URL_ENCODED_APPROVED_TITLE\`
- Project: \`https://github.com/joelhooks/rat-stack/issues/new?template=cafe-project.yml&title=URL_ENCODED_APPROVED_TITLE\`

Replace the title placeholder with the URL-encoded approved title. Prefill form fields with URL-encoded values using their form IDs as query keys. The person can review and file the issue in GitHub.

Joel or the desk reviews each suggestion. Listing is not guaranteed.
`;

export const agentNextActions = (
  origin: string,
  workshopTitle: string
) => `## Choose the next action

1. Search for the job you need with \`search({ query, limit })\`.
2. Read a matching document with \`read({ id })\`, using the stable id returned by search. Read the owning rules and skill before changing code.
3. For lore, follow \`backlinks({ slug })\` or \`neighbors({ slug, depth: 1 })\` to related pages. Use \`mentions({ slug })\` for unlinked references and \`path({ from, to })\` to connect two lore pages. Use the page's lore slug, not a source file path.

A capability is one named action with shared input and output definitions and a server-side implementation.

For a new behavior, start with [one capability, every surface](${origin}/lore/one-capability-every-surface) and [add a capability](${origin}/skills/add-a-capability). For stateful work, read [add a lifecycle machine](${origin}/skills/add-a-lifecycle-machine). For a provider, keep the port in core: an application-owned interface named for the job it needs. Keep the adapter, its provider-specific implementation, outside core: [hexagonal architecture](${origin}/lore/hexagonal-architecture). For agent-facing guidance, read [HATEOAS](${origin}/lore/hateoas).

To remove a surface or package you don't need, follow [Keep or cut](${origin}/README.md#keep-or-cut) and the [keep-or-cut skill](${origin}/skills/keep-or-cut). Trace the imports, delete what depends on it, then run \`pnpm turbo run check test build\`.

[Interest signup](${origin}/systems/interest) is agent-only. Read [${workshopTitle}](${origin}/tokenmaxx#interested), obtain a fresh page ticket, and submit through \`joinInterest\` only after the person approves the exact card and contact permission. A person confirms their email through the email link in a browser; submission is not confirmation. Show the returned message to the person. If it says "Too many requests right now. Try again in a minute.", wait one minute and retry once. If it says the confirmation email could not be sent yet, do not resubmit; the application is saved.

Workshop resources have a separate [MCP server](${origin}/tokenmaxx/mcp). Use it for the schedule, prep, public links and published exercises. Applications still use the main server's \`joinInterest\`.

${cafeSubmissionGuide(origin)}
`;
