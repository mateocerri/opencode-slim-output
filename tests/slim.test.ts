import { describe, expect, test } from "bun:test";
import { collapseStacks, dedupConsecutive, relativizePaths, slimOutput } from "../src/slim";

const CWD = "/home/mateo/proj";

const PY_TRACE = `Traceback (most recent call last):
  File "/home/mateo/proj/app/main.py", line 10, in <module>
    run()
  File "/home/mateo/proj/app/service.py", line 42, in run
    handle()
  File "/home/mateo/proj/.venv/lib/python3.12/site-packages/requests/api.py", line 123, in handle
    return go()
  File "/home/mateo/proj/.venv/lib/python3.12/site-packages/urllib3/connection.py", line 99, in go
    sock.connect()
  File "/usr/lib/python3.12/socket.py", line 456, in connect
    self._real_connect()
ConnectionError: boom`;

describe("python traceback", () => {
  test("collapses external frames, keeps project + error", () => {
    const out = slimOutput(PY_TRACE, { cwd: CWD, command: "pytest" });
    expect(out).toContain("ConnectionError: boom");
    expect(out).toContain("./app/main.py");
    expect(out).toContain("./app/service.py");
    expect(out).toContain("external frames omitted");
    expect(out).not.toContain("urllib3/connection.py");
    expect(out).not.toContain("/home/mateo/proj/app/main.py");
  });
  test("without anchor, frames untouched", () => {
    const noAnchor = `  File "/x/a.py", line 1, in f\n  File "/x/b.py", line 2, in g`;
    expect(slimOutput(noAnchor, { command: "echo hi" })).toBe(noAnchor);
  });
});

const DOTNET_STACK = `System.NullReferenceException: boom
   at MyApp.Service.Handle() in /home/mateo/proj/src/Service.cs:line 42
   at System.Runtime.CompilerServices.TaskAwaiter.HandleNonSuccess()
   at System.Threading.Tasks.Task.Execute()
   at Microsoft.Extensions.Hosting.Host.Start()
   at MyApp.Program.Main() in /home/mateo/proj/src/Program.cs:line 10`;

describe("dotnet stack", () => {
  test("collapses System/Microsoft frames", () => {
    const out = slimOutput(DOTNET_STACK, { cwd: CWD, command: "dotnet test" });
    expect(out).toContain("NullReferenceException: boom");
    expect(out).toContain("MyApp.Service.Handle()");
    expect(out).toContain("MyApp.Program.Main()");
    expect(out).toContain("external frames omitted");
    expect(out).not.toContain("TaskAwaiter");
  });
});

const JEST_STACK = `FAIL src/main.test.js
  ● Main > works
    expect(received).toBe(expected)
    Expected: 4
    Received: 3
      at Object.<anonymous> (src/main.test.js:6:29)
      at Object.<anonymous> (/app/node_modules/jest-runner/build/index.js:1:2)
      at node:internal/process/task_queues:1:1
      at node:internal/modules/cjs/loader:2:3
Test Suites: 1 failed, 1 total`;

describe("jest stack", () => {
  test("collapses node internals, keeps assertion", () => {
    const out = slimOutput(JEST_STACK, { command: "jest" });
    expect(out).toContain("Expected: 4");
    expect(out).toContain("at Object.<anonymous> (src/main.test.js:6:29)");
    expect(out).toContain("external frames omitted");
    expect(out).not.toContain("task_queues");
  });
});

describe("adversarial prose", () => {
  test("novel text untouched", () => {
    const prose = `We met at noon near the old mill.\nSee file x for details.\nThe dll of the system hummed softly.`;
    expect(slimOutput(prose, { command: "cat novel.txt" })).toBe(prose);
  });
  test("diff with paths but no anchor untouched", () => {
    const diff = `--- a/src/a.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new`;
    expect(slimOutput(diff, { command: "git diff" })).toBe(diff);
  });
});

describe("paths and repetition", () => {
  test("relativizes cwd prefix", () => {
    const out = relativizePaths(`${CWD}/a.ts\n${CWD}/b.ts`, CWD);
    expect(out).toBe("./a.ts\n./b.ts");
  });
  test("dedups consecutive repeats", () => {
    expect(dedupConsecutive(["ok", "ok", "ok", "done"])).toEqual(["ok (x3)", "done"]);
  });
  test("long find output truncated with marker", () => {
    const big = Array.from({ length: 300 }, (_, i) => `${CWD}/f${i}.ts`).join("\n");
    const out = slimOutput(big, { cwd: CWD, command: "find . -type f" });
    expect(out).toContain("./f0.ts");
    expect(out).toContain("truncated by slim-output");
    expect(out.split("\n").length).toBeLessThan(150);
  });
  test("empty and tiny outputs passthrough", () => {
    expect(slimOutput("", {})).toBe("");
    expect(slimOutput("ok", { command: "go test" })).toBe("ok");
  });
});

describe("collapseStacks unit", () => {
  test("short runs kept verbatim", () => {
    const lines = [
      "Traceback (most recent call last):",
      '  File "a.py", line 1, in f',
      "ValueError: x",
    ];
    const { lines: out, collapsed } = collapseStacks(lines, { command: "python x.py" });
    expect(collapsed).toBe(0);
    expect(out).toEqual(lines);
  });
});
