import type { Plugin } from "@opencode-ai/plugin";
import { slimOutput } from "./src/slim";

interface SlimPluginOptions {
  maxLines?: number;
  maxLineLen?: number;
  maxFrames?: number;
  enabled?: boolean;
}

const COVERED_TOOLS = new Set(["bash", "grep", "glob", "read"]);

// opencode passes hook payloads as (input, output) where input.tool is the
// tool name, output.output is the string result and output.args holds params.
// Shapes vary across versions, so everything below is defensive: any doubt
// means passthrough (fail-closed).
export const SlimOutputPlugin = (async (ctx, opts?: SlimPluginOptions) => {
  const directory = (ctx as unknown as { directory?: string }).directory ?? "";
  const enabled = opts?.enabled ?? true;

  return {
    "tool.execute.after": async (input: any, output: any) => {
      try {
        if (!enabled) return;
        if (!input || !output) return;
        if (!COVERED_TOOLS.has(input.tool)) return;
        if (typeof output.output !== "string" || output.output.length === 0) return;
        // Never touch directory listings shaped as XMLISH dir output? No —
        // relativizing still helps there. Only skip tiny outputs for speed.
        if (output.output.length < 40) return;

        const command =
          typeof output.args?.command === "string"
            ? output.args.command
            : typeof input.tool === "string"
              ? input.tool
              : undefined;

        output.output = slimOutput(output.output, {
          cwd: directory || undefined,
          command,
          maxLines: opts?.maxLines,
          maxLineLen: opts?.maxLineLen,
          maxFrames: opts?.maxFrames,
        });
      } catch {
        // fail-closed: leave output untouched
      }
    },
  };
}) as unknown as Plugin;

export default SlimOutputPlugin;
