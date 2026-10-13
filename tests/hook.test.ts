import { describe, expect, test } from "bun:test";
import definition from "../plugin";

const CWD = "/home/mateo/proj";

function trace(n: number): string {
  const frames = Array.from(
    { length: n },
    (_, i) => `  File "/home/mateo/proj/.venv/lib/pkg/mod${i}.py", line ${i}, in f\n    go()`,
  );
  return `Traceback (most recent call last):\n${frames.join("\n")}\n  File "./app/main.py", line 10, in <module>\n    run()\nValueError: boom`;
}

async function afterHook(options: Record<string, unknown> = {}) {
  const hooks: Record<string, (e: unknown) => Promise<unknown>> = {};
  await (definition as { setup: (ctx: unknown) => Promise<void> }).setup({
    options,
    tool: {
      hook: async (name: string, cb: (e: unknown) => Promise<unknown>) => {
        hooks[name] = cb;
      },
    },
  });
  return hooks["execute.after"];
}

describe("execute.after wiring (v2 result shape)", () => {
  test("slims string content", async () => {
    const after = await afterHook();
    const event = {
      tool: "shell",
      input: { command: "pytest", cwd: CWD },
      status: "completed",
      result: { content: trace(8) },
    };
    await after(event);
    const out = (event.result as { content: string }).content;
    expect(out).toContain("ValueError: boom");
    expect(out).toContain("frames omitted");
    expect(out).not.toContain("mod0.py");
  });

  test("slims text parts, leaves other parts alone", async () => {
    const after = await afterHook();
    const event = {
      tool: "shell",
      input: { command: "pytest", cwd: CWD },
      status: "completed",
      result: { content: [{ type: "text", text: trace(8) }, { type: "image", data: "abc" }] },
    };
    await after(event);
    const content = (event.result as { content: Array<Record<string, unknown>> }).content;
    expect(content[0].text).toContain("frames omitted");
    expect(content[1]).toEqual({ type: "image", data: "abc" });
  });

  test("unknown shapes pass through untouched", async () => {
    const after = await afterHook();
    const legacy = { tool: "shell", input: { command: "pytest" }, result: trace(8) };
    await after(legacy);
    expect(legacy.result).toContain("mod0.py");
    const noResult = { tool: "shell", input: { command: "pytest" } };
    await after(noResult);
    const otherTool = {
      tool: "write",
      input: {},
      status: "completed",
      result: { content: trace(8) },
    };
    await after(otherTool);
    expect((otherTool.result as { content: string }).content).toContain("mod0.py");
  });
});
