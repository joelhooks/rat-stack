# ratstack.sh auth.md

You do not need an account or token to read public content on ratstack.sh.

## Public access

- Send normal HTTPS requests to the public MCP, A2A, and HTTP routes.
- Do not send credentials for public content operations.
- Interest signup requires email confirmation, separately from public API access.
- Public content does not use OAuth.

## Optional learn feedback

`AUTH_ENABLED` defaults to false. Mischief serves the public phone, HTTP, and MCP surfaces. Better Auth runs in a private Worker reached only through a service binding. The private Worker has no public route and disables `workersDev`. Feedback sign-in tools and routes are absent when it is off.

When this surface exposes `learnFeedbackStart`, an agent can request a short code and a phone verification URL. The person signs in with email and password, then approves that code. `learnFeedbackPoll` returns a feedback-only credential after approval. `learnFeedback` stores feedback on a public card against the approving person.

The agent credential cannot authorize another capability or create a sign-in session. It expires with the device grant. Follow the returned polling interval. The stock `/auth/device/token` exchange is disabled. Never send passwords or session cookies to an agent.
