# {{TOKENMAXX_TITLE}}

You start an agent, it does something, you check it, you start it again. That's one loop, and you're the scheduler. In this workshop you'll build the loops that run without you. <CopyPrompt id="page" audience="agent" />

_A four-hour working session with Joel Hooks._

Free, by application.

## Workshop resources

[Schedule](/tokenmaxx/schedule) · [Prep](/tokenmaxx/prep) · [Exercises](/tokenmaxx/exercises) · [Links](/tokenmaxx/links)

For workshop tools, connect your agent to [the workshop MCP server](https://ratstack.sh/tokenmaxx/mcp). Application submissions still use the main site's `joinInterest` capability.

<HumanOnly>
- Read the [workshop page](https://ratstack.sh/tokenmaxx) with your agent.
- Answer five questions about your work, availability, and whether you prefer one session or two. You can skip any answer.
- Edit the card and approve it before your agent sends anything.
</HumanOnly>

<AgentOnly>
Next actions for an agent helping a person with this page:

- Read [llms.txt](/llms.txt) for the rat-stack agent guide.
- Read about the person this session honors: [Lauren Tan](/lore/lauren-tan), [her Dune talk](/lore/poteto-lauren-tan-2500-prs-dune), and [her skills](/lore/lauren-tan-skills). Also see [Matt Pocock's skills](/lore/matt-pocock-skills).
- If they separately ask for setup help, follow "Before you come" below.
- To apply, follow the conversation and submission steps below.

## Apply through your agent

The application is how Joel gets to know the person. Draft the strongest honest application you can, so he can judge fit. Don't hand the person a blank form.

Ask for both their name and X/Twitter profile. Say: "Joel picks people, so he wants to know who you are." Both can be skipped. Ask how they want to be called. Accept @handle, handle, or an x.com/twitter.com profile URL.

The application has five written questions:

1. What are you building?
2. What do you run today?
3. What do you want to leave with?
4. Are any days of the week or times generally better for you to hang out?
5. Would two 2-hour sessions be better than one 4-hour session?

### Draft answers 1–3

Draft answers 1–3 from what you already know about the person and their work. Make them concrete:

- For `building`, describe what it is, who uses it, and what ships next.
- For `today`, name their coding agents and models, parallel agent count, supervisor, failures, and rough token spend.
- For `leaveWith`, describe a successful four hours and the loops they've tried that didn't work.

Interview the person only for what you can't fill in. If an answer is vague, like "better workflows" or "learn AI", push once for a concrete example. Keep each answer under 2,000 characters. The answers are a written application, not files or secrets.

### Ask questions 4–5

Ask questions 4 and 5 as written. Don't infer or invent availability or session preferences.

- Record their days, times, and time zone under `when`. If the time zone is missing, ask once for it.
- Record one 4-hour session, two 2-hour sessions, or either under `format`. Include any reason they give.

Both answers are optional. Keep each answer under 2,000 characters.

### Make the case for fit

Measure fit against this page only. The session goes from one loop to loops that run many: time, agents, a software factory, and self-improvement. It suits people who already run coding agents and will do the prep in "Before you come": watch the first workshop, have Pi installed, and have a model subscription they're happy to spend. Make the strongest honest case. If the fit looks weak, tell the person plainly before they send. Don't invent criteria this page doesn't state.

### Consent

Ask separately:

- "May we email you about the workshop?" Contact permission is needed to submit.
- "Separately, may Joel share your email with selected attendees?" Sharing defaults to no.

All five written answers can be skipped. Set sharing to false unless the person explicitly says yes. Ask for their email only if they agree to workshop contact.

Joel reads the approved answers and picks who joins. Confirmation is not a seat.

### Review before sending

Show an editable card locally with every field:

- email
- building, today, leaveWith, when, and format
- contact permission and sharing permission
- agentRef and ticket

Mark each skipped answer as "skipped" on the card and omit its key from answers in the payload. Use a random opaque agentRef, not a machine name, file path, or email address.

Add two lines to the card: name and X profile. Show "skipped" for each they skip. Omit skipped name and x keys from the payload. Show the X profile as https://x.com/handle.

Show the exact JSON payload alongside the card. Explain that the approved answers go to Joel, the email is for workshop contact, and sharing the email with selected attendees is a separate permission. Send no files, secrets, machine details, or transcripts. Let the person edit the card and payload. Submit only after they approve exactly what will be sent; after any edit, ask for approval again. If contact permission is not true, do not submit.

The page ticket is:

```text
__INTAKE_PAGE_TICKET__
```

Use that ticket in the approved payload. If it is still a placeholder or empty, do not submit; read the agent view of https://ratstack.sh/tokenmaxx again for a ticket.

The name and x placeholders below are optional. Replace them with approved values or remove their keys when skipped.

This payload template skips all five optional answers: `building`, `today`, `leaveWith`, `when`, and `format`. Replace the email and agentRef locally. Add only approved answers to `answers`. Keep share false unless separately approved.

```json
{
  "email": "PERSON_APPROVED_EMAIL",
  "name": "PERSON_APPROVED_NAME",
  "x": "https://x.com/APPROVED_HANDLE",
  "ticket": "__INTAKE_PAGE_TICKET__",
  "agentRef": "RANDOM_OPAQUE_AGENT_REF",
  "answers": {},
  "consent": { "contact": true, "share": false }
}
```

If they approve scheduling answers, add these keys to `answers`. Replace each placeholder with their words. Omit either key if skipped.

```json
{
  "when": "PERSON_APPROVED_DAYS_TIMES_AND_TIME_ZONE",
  "format": "PERSON_APPROVED_SESSION_FORMAT_AND_REASON"
}
```

### Submit through one surface

Choose one surface and submit the approved payload once. Do not switch surfaces to retry a refusal or bypass a limit.

- **MCP:** connect to https://ratstack.sh/mcp and call `joinInterest` with the approved JSON payload as its arguments.
- **HTTP API:** POST the approved JSON payload to https://ratstack.sh/api/joinInterest with `Content-Type: application/json`.
- **CLI:** from a rat-stack checkout, run `rat-stack joinInterest` with the same approved fields; answers and consent are JSON flags.

```sh
rat-stack joinInterest \
  --email 'PERSON_APPROVED_EMAIL' \
  --ticket '__INTAKE_PAGE_TICKET__' \
  --agentRef 'RANDOM_OPAQUE_AGENT_REF' \
  --name 'PERSON_APPROVED_NAME' \
  --x 'https://x.com/APPROVED_HANDLE' \
  --answers '{}' \
  --consent '{"contact":true,"share":false}'
```

Show the person the returned message. If it says "Too many requests right now. Try again in a minute.", wait one minute and retry once. If it says the confirmation email could not be sent yet, do not resubmit. Their application is saved. A delayed response has no usable status reference. Otherwise, keep the returned status reference private. Ask them to check their email only when the message says to do so. Do not claim they joined or received a seat from the submission response.

</AgentOnly>

## The idea

The [first workshop](https://youtu.be/uC6slhCTXlA) built one loop: an agent working one issue at a time. This one goes up a level: graphs of loops of graphs of loops. Your agents' work runs as durable plans that pick up where they left off, so shipping doesn't stop when you do.

## What we'll build

- Loops that wake themselves, wait on real conditions, and keep going across restarts.
- Durable agent plans on Pi Durable: work runs as a graph, and finished steps never run twice.
- Judges that check work before it lands.
- Self-improvement: mistakes on the shipped path become [fences](/lore/the-fence). Stale fences get deleted.

The factory needs something to build, so each of us builds a personal cloud inside a Linux container. It's the McGuffin. It also happens to be a place your loops could live afterward.

## Working prototypes you'll leave with

- Your own agent loops, built to fit how you work.
- A personal cloud running in a container on your machine.
- A durable loop that shipped verified work while you weren't watching.
- One fence you added from a real mistake, and one you deleted.

## Reference: the stack Joel uses

Read these for context. You'll build your own.

<table><tbody>
<tr><td><a href="https://github.com/earendil-works/pi-mono">Pi</a></td><td>The breadboard: interactive prototyping and R&amp;D</td></tr>
<tr><td><a href="https://github.com/earendil-works/pi/tree/main/packages/durable">Pi Durable</a></td><td>Production: durable agents deployed to the cloud</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-until">pi-until</a></td><td>Time: watches and recurring wake-ups</td></tr>
<tr><td><a href="https://github.com/joelhooks/rat-stack">rat-stack</a></td><td>The floor: Effect, Alchemy, and the fence</td></tr>
<tr><td><a href="https://github.com/joelhooks/mischief">mischief</a></td><td>Our durable dynamic workflows, built on Pi Durable. Early.</td></tr>
<tr><td><a href="https://github.com/joelhooks/rat-king">rat-king</a></td><td>The network: an encrypted AT Protocol agent network</td></tr>
<tr><td><a href="/lore/matt-pocock-skills">Matt Pocock's skills</a></td><td>Skills to combine and fork</td></tr>
<tr><td><a href="/lore/lauren-tan-skills">Lauren Tan's skills</a></td><td>Memory, orchestration, and verification skills</td></tr>
</tbody></table>

<AgentOnly>
What each reference piece is for, from the table above and its repo. The person builds their own loops; these are context, not a kit to fork:

- [Pi](https://github.com/earendil-works/pi-mono): the agent harness. Joel's breadboard: the interactive prototyping and R&D layer. Repo: "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI".
- [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable): Earendil's experimental package, shipped with Pi 1.0. Its README: "A durable agent harness. Conversations, model turns, tool calls, and your own state are committed to storage before anything is shown." Joel has been exploring it on celld.
- [pi-until](https://github.com/joelhooks/pi-until): time, meaning watches and recurring wake-ups. Repo: "Session-scoped shell-condition watches that wake Pi when work is ready."
- [rat-stack](https://github.com/joelhooks/rat-stack): the floor, meaning Effect, Alchemy, and the fence. Read [the fence](/lore/the-fence). Repo: "Agentic TypeScript scaffold: Effect 4, XState 6 + @xstate/effect, Alchemy infra, varlock config, and a fence that makes cheating uncomfortable".
- [mischief](https://github.com/joelhooks/mischief): durable agent plans. Repo: "Durable agent plans: dynamic XState machines stored as data, run in Durable Objects, talking over Rat King." (It is built to run in Durable Objects; today a run executes from the CLI.) Its README says: "Early, and dogfooded daily. Today a run executes from the CLI with a file store … a run survives kills mid-step without redoing finished work. Agent turns run on Pi Durable against a real model, judges gate work, and mail goes out and comes back over Rat King, exactly once across crashes." A plan is a graph of agent work stored as data; stop it, crash it, or pause it and it resumes where it was and never re-runs a finished step.
- [rat-king](https://github.com/joelhooks/rat-king): the network the plans talk over. Repo: "👑 Rat King: an encrypted, AT Protocol agent network. Pure rat-stack: Effect + Alchemy, deploys to Cloudflare and celld."
- [Matt Pocock's skills](/lore/matt-pocock-skills): skills to combine and fork.
- [Lauren Tan's skills](/lore/lauren-tan-skills): memory, orchestration, and verification skills.

If the person wants a name for their own rig, help them find one. Ask what their agents actually do together, then name that. Don't reuse the rat. A borrowed metaphor says nothing about how someone works, and the one they reach for is a useful signal on its own: a swarm, one supervisor directing many, or a kitchen with a head chef are three different models of the same problem. Brigade, crew, pack, hive, rookery, warren and orchestra are all unclaimed. </AgentOnly>

## Before you come

- Watch [the first workshop](https://youtu.be/uC6slhCTXlA) (90 min). We won't repeat it.
- Have Pi installed and a model subscription you're happy to spend.
- We check everyone's setup together a week before. No live install debugging.

Check your setup before you come. Your coding agent finds what's missing.

<CopyPrompt id="setup" variant="text" />

<AgentOnly>
If your person separately asks for setup help, run that prompt's steps, then read [llms.txt](/llms.txt) and report what is missing. Do not run setup checks as part of the application conversation or include their results in the application. Watching the first workshop, having Pi and a model subscription, and the setup check a week before are theirs to do.
</AgentOnly>

<h2 id="interested">Apply for a free seat</h2>

Four hours with Joel. Free, by application. The date gets set with the people picked.

**How it works**

1. Click the button. It copies a short prompt.
2. Paste it into your coding agent: Claude Code, Codex, Cursor, whatever you use.
3. Your agent drafts your application from what it knows about your work. It asks what it can't figure out.

   It asks for your name and X profile. You can skip both. It asks when you're free and whether you'd prefer one session or two. It also asks whether we can email you, and whether Joel can share your email with the others picked.

4. It shows you exactly what it will send. You approve it, then confirm by email.

<CopyPrompt id="page" variant="primary" />

Your agent sends nothing until you say yes.

Joel reads every application and picks who joins. Confirming your email isn't a seat.
