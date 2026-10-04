# Check the actual artifact before declaring done

**Applies when:** finishing work or reviewing another agent's result.

Inspect the changed artifact and exercise the behavior it claims. Report code-ready, deployed, and behavior-verified as separate facts.

**Why:** A passing compiler or confident summary is not runtime evidence.

**Example:** `.brain/areas/analytics.svx` separates a visitor cookie from proof of warehouse delivery.

**Held by:** `pnpm turbo run check test build`; review for runtime and deployment readback.

**Prior art:** Adapted from pstack's `principle-prove-it-works` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
