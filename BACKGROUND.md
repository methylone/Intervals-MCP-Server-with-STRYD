English | [日本語](BACKGROUND.ja.md)

# Background

A short, informal history of why this server exists and the principles behind it.
Context for anyone forking the project — not a spec.

## Why it was built

It started as a personal tool: a developer who is also an endurance runner wanted
an AI assistant that could analyze training data *correctly*, rather than just
plausibly. Language models are good at narrative and pattern-spotting but should
not be trusted to compute training-load numbers by hand. So the goal became: let
the AI reason, but move every exact calculation into deterministic code it can call.

## Core principle: deterministic server, separate knowledge

Two ideas shaped the design:

1. **Deterministic vs. probabilistic split.** Anything that must be exact —
   Performance Management Chart values, exponential moving averages, decoupling,
   rolling HRV statistics — lives in tested TypeScript, not in the model's head.
   The server is the deterministic half; the AI client is the probabilistic half.

2. **Code vs. methodology split.** This server knows nothing about *how* to train.
   Training philosophy, zone models, and plan logic are kept entirely separate, in
   a knowledge file the user writes and feeds to their AI client. That keeps the
   code generic and reusable, and lets each user bring their own methodology. The
   public repo ships only an empty template for this — see
   `training-knowledge-template/`.

## How it grew

Development was incremental, guided by a "use first, then build" rule — validate a
need through real use before investing in infrastructure. Roughly in order:

- Core Intervals.icu access (activities, wellness, events, athlete summary).
- A Stryd power extension adding a lower-body-load Performance Management Chart
  computed server-side, alongside the built-in load metric.
- Stream-level analysis (splits, cardiac decoupling, terrain-aware pacing).
- Calendar event create / update / delete for loading training plans.
- HRV recovery-trend statistics (rolling mean / SD / CV) for readiness analysis.

A core / extension separation kept the generic parts reusable and the
power-meter-specific parts optional. A small "tool inventory" test guards against
tools silently disappearing during refactors — a failure mode that actually
happened once and was easy to miss.

## On the development process

Much of the build was done with AI assistance in a layered way: one model for
design and review, another for implementation, with hand-off notes passed between
them. It's an experiment in AI-assisted development as much as a training tool.
That detailed history lives in a private development log; this public repository is
a clean snapshot of the result.
