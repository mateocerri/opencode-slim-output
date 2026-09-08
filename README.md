# opencode-slim-output

OpenCode plugin: fail-closed post-processor for `bash/grep/glob/read` output.
Collapses external stack frames, relativizes `cwd` paths, dedups repeats.
Algorithmic, no LLM, no binary deps. Complements `snip` (per-tool summaries)
and `openslimedit` (tool-definition compression).

## Rule

Non-frame lines are never deleted. Collapsing requires command gate + anchor
+ run of ≥3 frames. Doubt → passthrough.

## Use

Dev (this repo is the plugin):

```json
{ "$schema": "https://opencode.ai/config.json", "plugin": ["/home/mateo/opencode-slim-output/plugin.ts"] }
```

Or copy `plugin.ts` + `src/` to `~/.config/opencode/plugins/`.
Options: `[".../plugin.ts", { "maxLines": 120, "maxLineLen": 160, "maxFrames": 40 }]`.

Prompt guidance (`AGENTS.md`): prefer native `glob/grep` → CodeGraph/Graphify →
LSP over `bash find/grep`; use `pytest -q --tb=line`, no `-v` unless failed.

## Dev

`bun test`, `bun run typecheck`
