# opencode-slim-trace

An OpenCode plugin that shrinks noisy tool output before it reaches the model:
external stack frames collapse to one line, absolute paths become relative,
repeated lines get counted. No LLM, no binaries, ~zero latency.

It complements [snip](https://github.com/edouard-claude/snip) (per-tool
summaries for `bash`) and [openslimedit](https://github.com/ASidorenkoCode/openslimedit)
(tool-definition compression). This plugin covers what neither does:
cross-language stack-trace pruning on `bash`, `grep`, `glob` and `read`.

## Example

Python traceback before (11 lines, 3 from your code):

```
Traceback (most recent call last):
  File "/home/you/proj/app/service.py", line 42, in run
    handle()
  File "/home/you/proj/.venv/lib/python3.12/site-packages/requests/api.py", line 123, in handle
    return go()
  File "/home/you/proj/.venv/lib/python3.12/site-packages/urllib3/connection.py", line 99, in go
    sock.connect()
  File "/usr/lib/python3.12/socket.py", line 456, in connect
    self._real_connect()
ConnectionError: boom
```

After:

```
Traceback (most recent call last):
  File "./app/service.py", line 42, in run
    handle()
... +3 external frames omitted (site-packages/stdlib)
ConnectionError: boom
```

Your frames and the error survive. stdlib plumbing doesn't.

## Install

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/path/to/opencode-slim-trace/plugin.ts"],
}
```

With options:

```jsonc
"plugin": [["/path/to/opencode-slim-trace/plugin.ts",
  { "maxLines": 120, "maxLineLen": 160, "maxFrames": 40 }]]
```

Restart opencode. Or copy `plugin.ts` + `src/` into
`~/.config/opencode/plugins/` — files there load automatically.

## How it decides

A line is collapsed only if three signals agree:

1. **Command gate** — each detector runs only where its noise is expected
   (`pytest`/`python` for Python frames, `dotnet` for .NET, `jest`/`tsc`/`node`
   for JS, and so on).
2. **Anchor** — the output must contain a wrapper proving a stack is present
   (`Traceback (most recent call last):`, `NullReferenceException`,
   `FAIL`, `panicked`, …). Prose mentioning "file x" has no anchor and is
   left alone.
3. **Frame shape** — a line must match fully (`File "…", line N`,
   `at Ns.Type.Method(…)`, `path/to/file.go:123`, …), in a run of 3+.

Anything else passes through untouched. Unknown frames are kept; only
known-external paths (`site-packages`, `node_modules`, `System.*`, `*.dll`,
`jdk.internal`, …) collapse, and every collapse leaves a counted marker.

## Limits

- Truncates to `maxLines` / `maxLineLen` with an overflow marker; the raw
  output is not stored — rerun the command if you need it all.
- `compact_path`-style shortening is deliberately avoided: a path the model
  can't open costs more than the characters it saves.

## Develop

```sh
bun install
bun test        # 11 tests, incl. adversarial prose fixtures
bun run typecheck
```
