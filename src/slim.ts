// slim-output core: fail-closed post-processor for tool output.
// Pure functions, no opencode deps. Rules:
// - Non-frame lines are NEVER deleted (errors/summaries always survive).
// - Frame collapsing requires: command gate + anchor + run of >= minFrames.
// - Ambiguous input -> passthrough. Never invent paths.

export interface SlimOptions {
  cwd?: string;
  command?: string;
  maxLines?: number;
  maxLineLen?: number;
  maxFrames?: number;
  minFrames?: number;
}

export type StackKind = "py" | "js" | "dotnet" | "java" | "rust" | "go";

const DEFAULTS = { maxLines: 120, maxLineLen: 160, maxFrames: 40, minFrames: 3 };

// ---- command gates: which detectors may run for a given command/tool ----
const GATES: Record<StackKind, RegExp> = {
  py: /(pytest|python|ruff|mypy|basedpyright|ty|uv|poetry|pip)/i,
  js: /(jest|vitest|tsc|eslint|biome|oxlint|node|bun|deno|npm|yarn|pnpm|nx|turbo|next|playwright|prettier)/i,
  dotnet: /(dotnet)/i,
  java: /(mvn|gradle|gradlew|java|spring)/i,
  rust: /(cargo|rustc|nextest)/i,
  go: /(^|\s)(go|golangci-lint)(\s|$)/i,
};

// ---- anchors: wrapper lines proving a stack is present (per kind) ----
const ANCHORS: Record<StackKind, RegExp> = {
  py: /Traceback \(most recent call last\)|^\S*(Error|Exception|AssertionError)\b/m,
  js: /\b(FAIL|Error:|Expected:|Received:|Test Suites:|●)/m,
  dotnet: /\b(Exception|Failed|error|Error)\b|^\s*at\s+\w+(\.\w+)+\(/m,
  java: /\b(Exception|Caused by:|FAILED|BUILD FAILURE)\b|^\s*at\s+[\w.$]+\(/m,
  rust: /\b(panicked|failures:|test result:)/m,
  go: /\b(FAIL|ok\s+\S+|--- FAIL|panic:|goroutine \d+)\b/m,
};

// ---- frame shapes: a line must match FULLY to count as a frame ----
const FRAMES: Record<StackKind, RegExp[]> = {
  py: [/^\s*File "([^"]+)", line \d+.*$/],
  js: [/^\s*at\s+.+\([^()]*:\d+:\d+\)\s*$/, /^\s*at\s+\S+\s*$/],
  dotnet: [/^\s*at\s+[\w.<>$`']+\.[\w.<>$`'()]+\(.*\)(\s+in\s+.*:\d+)?\s*$/],
  java: [/^\s*at\s+[\w.$]+\.[\w$<>]+\(.*\)(\s+\(.*\))?\s*$/],
  rust: [/^\s*\d+:\s+\S+.*$/, /^\s*at\s+.*:\d+:\d+\s*$/],
  go: [/^\s*[\w./\\-]+\.go:\d+.*$/, /^\s*goroutine \d+.*$/],
};

// ---- external classifiers: frames matching these are collapsible ----
// Name-based entries are anchored so they can't match project identifiers
// (e.g. `Object.<anonymous>` must NOT match, `com.sunshine` must NOT match).
const EXTERNAL: Record<StackKind, RegExp> = {
  py: /site-packages|dist-packages|\/venv\/|conda|lib\/python\d|<frozen|importlib[./]|runpy[./]|pkg_resources/,
  js: /node_modules|node:internal|internal\/process|\(<anonymous>\)|\(anonymous\)|node:sea/,
  dotnet: /\bSystem\.|\bMicrosoft\.|mscorlib|\.dll\b|dotnet[\\/]shared|C:\\Windows|NuGet/,
  java: /java\.base|jdk\.internal|\bsun\.|org\.junit|org\.gradle|org\.apache\b|com\.sun\.|kotlin\.|scala\./,
  rust: /core::|std::|alloc::|rustc\/|cargo\/registry/,
  go: /\/go\/src\/|GOROOT|golang\.org\/toolchain|pkg\/mod\/|GOMODCACHE/,
};

// Path segments that are external regardless of stack kind.
const EXTERNAL_HINT = /(node_modules|\.venv|\/venv\/|site-packages|dist-packages|pkg\/mod\/|\/go\/src\/)/;

const EXTERNAL_LABEL: Record<StackKind, string> = {
  py: "site-packages/stdlib",
  js: "node_modules/node:internal",
  dotnet: "System/Microsoft/.dll",
  java: "jdk/internal",
  rust: "std/core/registry",
  go: "stdlib/mod cache",
};

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Relativize only the exact cwd prefix — never strip bare src/lib segments. */
export function relativizePaths(text: string, cwd?: string): string {
  if (!cwd || cwd === "/" || cwd.length < 2) return text;
  const norm = cwd.replace(/\/+$/, "");
  return text.split(norm).join(".");
}

type LineClass =
  | { frame: false }
  | { frame: true; kind: StackKind; external: boolean };

function activeKinds(command: string | undefined, text: string): StackKind[] {
  const kinds = (Object.keys(GATES) as StackKind[]).filter((k) => {
    if (!command) return true; // unknown source: allow, anchor still required
    if (k === "go") return GATES.go.test(` ${command} `);
    return GATES[k].test(command);
  });
  return kinds.filter((k) => ANCHORS[k].test(text));
}


function classifyLine(line: string, kinds: StackKind[]): LineClass {
  for (const kind of kinds) {
    if (FRAMES[kind].some((re) => re.test(line))) {
      // Path hints win over everything: relativized venv/node_modules paths
      // start with ./ but are still external.
      if (EXTERNAL_HINT.test(line)) return { frame: true, kind, external: true };
      if (EXTERNAL[kind].test(line)) return { frame: true, kind, external: true };
      // Unknown frames are kept (fail-closed): only known-external collapses.
      return { frame: true, kind, external: false };
    }
  }
  return { frame: false };
}

/**
 * Code-context line shown under a frame (e.g. Python prints the source line
 * after each `File "..."` line). Absorbed into the surrounding frame run so
 * interleaved tracebacks still form a collapsible run. Emitted verbatim.
 */
function isContextLine(line: string): boolean {
  if (!/^\s+\S/.test(line)) return false;
  if (line.length > 200) return false;
  return !/(Error|Exception|assert|Traceback|^\s*(at\b|File\s|Caused by:))/m.test(line);
}

/** Collapse external sub-runs inside frame runs. Non-frame lines untouched. */
export function collapseStacks(
  lines: string[],
  opts: SlimOptions = {},
): { lines: string[]; collapsed: number } {
  const minFrames = opts.minFrames ?? DEFAULTS.minFrames;
  const maxFrames = opts.maxFrames ?? DEFAULTS.maxFrames;
  const kinds = activeKinds(opts.command, lines.join("\n"));
  if (kinds.length === 0) return { lines, collapsed: 0 };

  const cls: LineClass[] = lines.map((l) => classifyLine(l, kinds));
  const out: string[] = [];
  let collapsed = 0;
  let keptFrames = 0;
  let i = 0;

  while (i < lines.length) {
    if (!cls[i].frame) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // frame run boundaries: absorb single context lines (source snippets
    // printed under frames) so interleaved tracebacks stay one run
    let j = i;
    while (j < lines.length) {
      if ((cls[j] as LineClass).frame) {
        j++;
      } else if (
        j + 1 < lines.length &&
        (cls[j + 1] as LineClass).frame &&
        isContextLine(lines[j])
      ) {
        j++; // absorb context line into run
      } else break;
    }
    const run = lines.slice(i, j);
    const runCls = cls.slice(i, j) as Extract<LineClass, { frame: true }>[];

    if (run.length < minFrames) {
      // too short to trust -> keep verbatim
      out.push(...run);
      keptFrames += run.length;
      i = j;
      continue;
    }

    // Group run into units: each frame plus its attached context line(s).
    // Context attached to an external frame is dropped with the block;
    // context attached to a project frame is kept verbatim.
    type Unit = { external: boolean; kind: StackKind; text: string[] };
    const units: Unit[] = [];
    let k = 0;
    while (k < run.length) {
      const c = runCls[k] as LineClass;
      if (c.frame) {
        const text = [run[k]];
        let n = k + 1;
        while (
          n < run.length &&
          !(runCls[n] as LineClass).frame &&
          isContextLine(run[n])
        ) {
          text.push(run[n]);
          n++;
        }
        units.push({ external: c.external, kind: c.kind, text });
        k = n;
      } else {
        units.push({ external: false, kind: kinds[0], text: [run[k]] });
        k++;
      }
    }

    // walk units, collapse external blocks (any length >= 1)
    for (const u of units) {
      if (!u.external) {
        for (const t of u.text) {
          if (keptFrames < maxFrames) {
            out.push(t);
            keptFrames++;
          } else {
            collapsed++;
          }
        }
        continue;
      }
      const label = EXTERNAL_LABEL[u.kind] ?? "external";
      out.push(`... +1 external frames omitted (${label})`);
      collapsed += 1;
    }
    // merge adjacent markers into a single counted marker
    for (let m = out.length - 1; m > 0; m--) {
      const a = out[m].match(/^\.\.\. \+(\d+) external frames omitted \((.+)\)$/);
      const b = out[m - 1].match(/^\.\.\. \+(\d+) external frames omitted \((.+)\)$/);
      if (a && b && a[2] === b[2]) {
        out[m - 1] = `... +${Number(a[1]) + Number(b[1])} frames omitted (${a[2]})`;
        out.splice(m, 1);
      }
    }
    i = j;
  }

  return { lines: out, collapsed };
}

/** Collapse consecutive duplicate lines: a,a,a -> a (x3). */
export function dedupConsecutive(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const n = j - i;
    out.push(n > 1 ? `${lines[i]} (x${n})` : lines[i]);
    i = j;
  }
  return out;
}

export function truncateLine(line: string, max: number): string {
  if (line.length <= max) return line;
  const head = Math.ceil(max * 0.6);
  const tail = max - head - 1;
  return line.slice(0, head) + "…" + line.slice(line.length - tail);
}

export function slimOutput(text: string, opts: SlimOptions = {}): string {
  if (!text) return text;
  const maxLines = opts.maxLines ?? DEFAULTS.maxLines;
  const maxLineLen = opts.maxLineLen ?? DEFAULTS.maxLineLen;

  let clean = relativizePaths(stripAnsi(text).replace(/\r\n/g, "\n"), opts.cwd);
  let lines = clean.split("\n");

  const { lines: collapsedLines, collapsed } = collapseStacks(lines, opts);
  lines = dedupConsecutive(collapsedLines);
  lines = lines.map((l) => truncateLine(l, maxLineLen));

  let truncated = 0;
  if (lines.length > maxLines) {
    truncated = lines.length - maxLines;
    lines = lines.slice(0, maxLines);
    lines.push(`... +${truncated} more lines (truncated by slim-output)`);
  }
  if (collapsed > 0 && truncated === 0) {
    // marker already inline per collapsed run; nothing extra needed
  }
  return lines.join("\n");
}
