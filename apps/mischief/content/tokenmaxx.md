# how to burn a trillion tokens and get good results

_Loopcraft: the outer loop. A four-hour working session with Joel Hooks and up to three builders. We build a strong harness that raises the floor for your apps._ <CopyPrompt id="page" />

Free, by application. Very limited seats.

In honor of [Lauren Tan](https://x.com/poteto), who [joined the four comma club](https://x.com/poteto/status/2104714676978479423) with 1.3 trillion tokens in one month. Burning tokens is easy. Almost all of it is agents re-reading context. Landing good work is the hard part, and that's what this session is about.

<AgentOnly>
Next actions for an agent helping a person with this page:

- Read [llms.txt](/llms.txt) for the rat-stack agent guide.
- Read about the person this session honors: [Lauren Tan](/lore/lauren-tan), [her Dune talk](/lore/poteto-lauren-tan-2500-prs-dune), and [her skills](/lore/lauren-tan-skills). Also see [Matt Pocock's skills](/lore/matt-pocock-skills).
- To get them ready, follow "Before you come" below.
- To join the interest list, a person submits the form at [/tokenmaxx#interested](/tokenmaxx#interested) in a browser. There is no agent path yet.
</AgentOnly>

<HumanOnly>
<figure>
<a href="https://x.com/poteto/status/2104714676978479423"><img src="/tokenmaxx/four-comma-club.jpg" width="1400" height="1043" alt="Lauren Tan (@poteto) on X, Sep 28, 2026: 'this month i joined the four comma club', with a chart showing 1.3T tokens from Aug 30 to today." /></a>
<figcaption><a href="https://x.com/poteto/status/2104714676978479423">@poteto on X, Sep 28, 2026</a></figcaption>
</figure>
</HumanOnly>

## The idea

The [first Loopcraft](https://youtu.be/uC6slhCTXlA) built one loop: an agent working one issue at a time. This one goes up a level, to the harness that runs many loops at once.

## What we'll build

- **Time.** Loops that wake themselves, wait on real conditions, and survive restarts.
- **Hands.** Agents in panes that a supervisor can watch, steer, and prove are working.
- **A software factory.** Lanes, a boss per lane, workers, and results checked before they land.
- **Self-improvement.** Mistakes on the shipped path become fences. Stale fences get deleted.

The factory needs something to build, so each of us builds a rat's nest: a small personal cloud inside a Linux container. It's the McGuffin. It also happens to be a place your harness could live afterward.

## What you leave with

- Your own fork of the harness, changed to fit how you work.
- A rat's nest running in a container on your machine.
- One software factory run that landed verified work.
- One fence you added from a real mistake, and one you deleted.

## The harness

<table><tbody>
<tr><td><a href="https://github.com/earendil-works/pi-mono">Pi</a></td><td>The agent harness</td></tr>
<tr><td><a href="https://herdr.dev">Herdr</a></td><td>Terminal workspace: spaces, tabs, panes</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-until">pi-until</a></td><td>Time: watches and recurring wake-ups</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-bellwether">pi-bellwether</a></td><td>Hands: agents in panes, supervised</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-muster">pi-muster</a></td><td>Factories: lanes, workers, verified results</td></tr>
<tr><td><a href="https://github.com/joelhooks/rat-stack">rat-stack</a></td><td>The floor: Effect, Alchemy, and the fence</td></tr>
<tr><td><a href="/lore/matt-pocock-skills">Matt Pocock's skills</a></td><td>Skills to combine and fork</td></tr>
<tr><td><a href="/lore/lauren-tan-skills">Lauren Tan's skills</a></td><td>Memory, orchestration, and verification skills</td></tr>
</tbody></table>

<AgentOnly>
What each piece is for, from the table above and its repo:

- [Pi](https://github.com/earendil-works/pi-mono): the agent harness. Repo: "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI".
- [Herdr](https://herdr.dev): terminal workspace, with spaces, tabs, and panes. Site: "the runtime coding agents run on".
- [pi-until](https://github.com/joelhooks/pi-until): time, meaning watches and recurring wake-ups. Repo: "Session-scoped shell-condition watches that wake Pi when work is ready."
- [pi-bellwether](https://github.com/joelhooks/pi-bellwether): hands, meaning agents in panes, supervised. Repo: "Pi package for managing Herdr agents, panes, and runtime sessions from Pi".
- [pi-muster](https://github.com/joelhooks/pi-muster): factories, meaning lanes, workers, and verified results. Repo: "the project manager for Herdr project spaces in Pi, on top of Bellwether".
- [rat-stack](https://github.com/joelhooks/rat-stack): the floor, meaning Effect, Alchemy, and the fence. Read [the fence](/lore/the-fence). Repo: "Agentic TypeScript scaffold: Effect 4, XState 6 + @xstate/effect, Alchemy infra, varlock config, and a fence that makes cheating uncomfortable".
- [Matt Pocock's skills](/lore/matt-pocock-skills): skills to combine and fork.
- [Lauren Tan's skills](/lore/lauren-tan-skills): memory, orchestration, and verification skills.
</AgentOnly>

## Before you come

- Watch [Loopcraft 1](https://youtu.be/uC6slhCTXlA) (90 min). We won't repeat it. The [9-minute harness tour](https://youtu.be/u2sbzYgREtQ) helps too.
- Have Pi installed and a model subscription you're happy to spend.
- We check everyone's setup together a week before. No live install debugging.

Paste this into Pi. It checks your setup and tells you what's missing:

<CopyPrompt id="setup" />

<AgentOnly>
If your person asked you to get them ready, run that prompt's steps, then read [llms.txt](/llms.txt) and report what is missing. Watching Loopcraft 1, having Pi and a model subscription, and the setup check a week before are theirs to do. Joining the list is a person's step in a browser: [/tokenmaxx#interested](/tokenmaxx#interested).
</AgentOnly>

## When

Date to be set with attendees.
