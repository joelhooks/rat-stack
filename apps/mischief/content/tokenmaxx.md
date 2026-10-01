# 🐀 how to burn a trillion tokens

_Loopcraft: the outer loop. A four-hour working session with Joel Hooks and up to three builders._

In honor of [Lauren Tan](https://x.com/poteto), who [joined the four comma club](https://x.com/poteto/status/2104714676978479423) with 1.3 trillion tokens in one month. Burning tokens is easy. Almost all of it is agents re-reading context. Landing good work is the hard part, and that's what this session is about.

<HumanOnly>
<figure>
<a href="https://x.com/poteto/status/2104714676978479423"><img src="/tokenmaxx/four-comma-club.jpg" width="1400" height="1043" alt="Lauren Tan (@poteto) on X, Sep 28, 2026: 'this month i joined the four comma club', with a chart showing 1.3T tokens from Aug 30 to today." /></a>
<figcaption><a href="https://x.com/poteto/status/2104714676978479423">@poteto on X, Sep 28, 2026</a></figcaption>
</figure>
</HumanOnly>

## The idea

The [first Loopcraft](https://youtu.be/uC6slhCTXlA) built one loop: an agent working one issue at a time. This one goes up a level, to the harness that runs many loops at once. It has two jobs.

|  | Software factory | Science factory |
| --- | --- | --- |
| Shape | Serial. Each step builds on the last. | Parallel. Many attempts at once. |
| What decides quality | The worst step. One bad step breaks the chain. | The best attempt. Dead ends are results, not waste. |
| What it needs | Fences that raise the floor | Wide fan-out and a hard judge |

Most harnesses get this wrong in one direction or the other: they fence exploration until nothing new survives, or they let exploration straight into the shipped path. We'll build one that knows the difference. Background reading: [Science is a strong-link problem](https://www.experimental-history.com/p/science-is-a-strong-link-problem).

## What we'll build

- **Time.** Loops that wake themselves, wait on real conditions, and survive restarts.
- **Hands.** Agents in panes that a supervisor can watch, steer, and prove are working.
- **A software factory.** Lanes, a boss per lane, workers, and results checked before they land.
- **A science factory.** Fan out N attempts at one problem, keep every branch, judge, land the best.
- **Self-improvement.** Mistakes on the shipped path become fences. Stale fences get deleted.

The factory needs something to build, so each of us builds a rat's nest: a small personal cloud inside a Linux container. It's the McGuffin. It also happens to be a place your harness could live afterward.

## What you leave with

- Your own fork of the harness, changed to fit how you work.
- A rat's nest running in a container on your machine.
- One software factory run that landed verified work.
- One science factory run: several branches, one judged winner, every dead end kept.
- One fence you added from a real mistake, and one you deleted.

## The harness

<table><tbody>
<tr><td><a href="https://github.com/earendil-works/pi-mono">Pi</a></td><td>The agent harness</td></tr>
<tr><td><a href="https://herdr.dev">Herdr</a></td><td>Terminal workspace: spaces, tabs, panes</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-until">pi-until</a></td><td>Time: watches and recurring wake-ups</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-bellwether">pi-bellwether</a></td><td>Hands: agents in panes, supervised</td></tr>
<tr><td><a href="https://github.com/joelhooks/pi-muster">pi-muster</a></td><td>Factories: lanes, workers, verified results</td></tr>
<tr><td><a href="https://github.com/joelhooks/rat-stack">rat-stack</a></td><td>The floor: Effect, Alchemy, and the fence</td></tr>
<tr><td><a href="https://github.com/mattpocock/skills">Matt Pocock's skills</a></td><td>Skills to combine and fork</td></tr>
</tbody></table>

## Before you come

- Watch [Loopcraft 1](https://youtu.be/uC6slhCTXlA) (90 min). We won't repeat it. The [9-minute harness tour](https://youtu.be/u2sbzYgREtQ) helps too.
- Have Pi installed and a model subscription you're happy to spend.
- Have Docker running (Docker Desktop or OrbStack).
- Start a repo from the template:

```sh
gh repo create my-factory --private --template joelhooks/rat-stack
```

- We check everyone's setup together a week before. No live install debugging.

## When

Date to be set with attendees.
