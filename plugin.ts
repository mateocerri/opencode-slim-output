import { Plugin } from "@opencode/plugin";
import { slimOutput } from "./src/slim.ts";

interface SlimPluginOptions {
  maxLines?: number;
  maxLineLen?: number;
  maxFrames?: number;
  minFrames?: number;
  enabled?: boolean;
  tools?: string[];
}

const DEFAULT_TOOLS = ["shell", "bash", "grep", "glob", "read"];

// OpenCode V2 port of the V1 SlimOutputPlugin. Same contract: fail-closed
// post-processor on tool results. Everything defensive: any doubt about the
// event shape means passthrough, output untouched.
export default Plugin.define({
  id: "slim-output",
  async setup(ctx) {
    const o = (ctx.options ?? {}) as SlimPluginOptions;
    if (o.enabled === false) return;
    const covered = new Set(o.tools ?? DEFAULT_TOOLS);

    await ctx.tool.hook("execute.after", async (event) => {
      try {
        const e = event as unknown as Record<string, unknown>;
        const input = (e.input ?? e.args ?? {}) as Record<string, unknown>;
        const tool =
          (typeof e.tool === "string" && e.tool) ||
          (typeof input.tool === "string" && input.tool) ||
          "";
        if (!tool || !covered.has(tool)) return;

        // V2 result shape: { output?, content?: string | parts[], ... }.
        // Anything else means passthrough (fail-closed).
        const result = e.result as { content?: unknown } | undefined;
        if (!result || typeof result !== "object") return;
        const command = (typeof input.command === "string" && input.command) || tool;
        const cwd =
          (typeof e.directory === "string" && e.directory) ||
          (typeof input.cwd === "string" && input.cwd) ||
          undefined;
        const opts = {
          cwd,
          command,
          maxLines: o.maxLines,
          maxLineLen: o.maxLineLen,
          maxFrames: o.maxFrames,
          minFrames: o.minFrames,
        };
        if (typeof result.content === "string") {
          if (result.content.length < 40) return; // tiny outputs: skip for speed
          result.content = slimOutput(result.content, opts);
        } else if (Array.isArray(result.content)) {
          for (const part of result.content) {
            if (
              part &&
              typeof part === "object" &&
              (part as { type?: unknown }).type === "text" &&
              typeof (part as { text?: unknown }).text === "string"
            ) {
              const p = part as { text: string };
              if (p.text.length >= 40) p.text = slimOutput(p.text, opts);
            }
          }
        }
        return;
      } catch {
        // fail-closed: leave output untouched
      }
    });
  },
});
