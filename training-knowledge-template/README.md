# Training Knowledge Template

This MCP server provides Intervals.icu data and deterministic computations
(PMC, cardiac decoupling, derived nutrition fields, etc.). **It does not interpret
your training.** Interpretation is done by your AI client (Claude Desktop, Codex,
etc.) reading a "knowledge" file that you write yourself.

This folder is a *template*: empty scaffolding for you to fill in. None of the files
here contain a real training methodology or anyone's personal numbers.

## How to use it
1. Copy each `*.example.md` file, drop the `.example`, and fill it with **your own**
   content.
2. Load the filled files as background knowledge in your AI client (e.g., a Claude
   Project, or paste them into the conversation context).
3. Ask your client to analyze your Intervals.icu data using this server's tools.

## How I built mine (one example)
I read a coaching book for my sport (for example, *Training Essentials for
Ultrarunning*), noted the principles that actually mattered for my own training
**into a markdown file, in my own words**, and gave that file to the AI as
background knowledge. I did the same for my zones/thresholds and my current race
plan.

Do the same with whatever methodology you follow. **Keep it your own paraphrase —
never paste copyrighted text from a book or article.** The AI works fine from your
own notes; it does not need the source material verbatim.

## Files
- `athlete_config.example.md` — your zones, thresholds, and data sources
- `methodology.example.md`    — your training principles, in your words
- `plan.example.md`           — your current training block / goal event
