export const agentNextActions = (origin: string) => `## Choose the next action

1. Search for the job you need with \`search({ query, limit })\`.
2. Read a matching document with \`read({ id })\`, using the stable id returned by search. Read the owning rules and skill before changing code.
3. For lore, follow \`backlinks({ slug })\` or \`neighbors({ slug, depth: 1 })\` to related pages. Use \`mentions({ slug })\` for unlinked references and \`path({ from, to })\` to connect two lore pages. Use the page's lore slug, not a source file path.

A capability is one named action with shared input and output definitions and a server-side implementation.

For a new behavior, start with [one capability, every surface](${origin}/lore/one-capability-every-surface) and [add a capability](${origin}/skills/add-a-capability). For stateful work, read [add a lifecycle machine](${origin}/skills/add-a-lifecycle-machine). For a provider, keep the port in core: an application-owned interface named for the job it needs. Keep the adapter, its provider-specific implementation, outside core: [hexagonal architecture](${origin}/lore/hexagonal-architecture). For agent-facing guidance, read [HATEOAS](${origin}/lore/hateoas).

[Interest signup](${origin}/systems/interest) is agent-only. Read the [workshop application steps](${origin}/tokenmaxx#interested), obtain a fresh page ticket, and submit through \`joinInterest\` only after the person approves the exact card and contact permission. A person confirms their email through the email link in a browser; submission is not confirmation.
`;
