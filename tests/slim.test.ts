import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { collapseStacks, dedupConsecutive, relativizePaths, slimOutput } from "../src/slim.ts";

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
    assert.ok(out.includes("ConnectionError: boom"));
    assert.ok(out.includes("./app/main.py"));
    assert.ok(out.includes("./app/service.py"));
    assert.ok(out.includes("external frames omitted"));
    assert.ok(!out.includes("urllib3/connection.py"));
    assert.ok(!out.includes("/home/mateo/proj/app/main.py"));
  });
  test("without anchor, frames untouched", () => {
    const noAnchor = `  File "/x/a.py", line 1, in f\n  File "/x/b.py", line 2, in g`;
    assert.equal(slimOutput(noAnchor, { command: "echo hi" }), noAnchor);
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
    assert.ok(out.includes("NullReferenceException: boom"));
    assert.ok(out.includes("MyApp.Service.Handle()"));
    assert.ok(out.includes("MyApp.Program.Main()"));
    assert.ok(out.includes("external frames omitted"));
    assert.ok(!out.includes("TaskAwaiter"));
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
    assert.ok(out.includes("Expected: 4"));
    assert.ok(out.includes("at Object.<anonymous> (src/main.test.js:6:29)"));
    assert.ok(out.includes("external frames omitted"));
    assert.ok(!out.includes("task_queues"));
  });
});

describe("adversarial prose", () => {
  test("novel text untouched", () => {
    const prose = `We met at noon near the old mill.\nSee file x for details.\nThe dll of the system hummed softly.`;
    assert.equal(slimOutput(prose, { command: "cat novel.txt" }), prose);
  });
  test("diff with paths but no anchor untouched", () => {
    const diff = `--- a/src/a.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new`;
    assert.equal(slimOutput(diff, { command: "git diff" }), diff);
  });
});

describe("paths and repetition", () => {
  test("relativizes cwd prefix", () => {
    const out = relativizePaths(`${CWD}/a.ts\n${CWD}/b.ts`, CWD);
    assert.equal(out, "./a.ts\n./b.ts");
  });
  test("dedups consecutive repeats", () => {
    assert.deepEqual(dedupConsecutive(["ok", "ok", "ok", "done"]), ["ok (x3)", "done"]);
  });
  test("long find output truncated with marker", () => {
    const big = Array.from({ length: 300 }, (_, i) => `${CWD}/f${i}.ts`).join("\n");
    const out = slimOutput(big, { cwd: CWD, command: "find . -type f" });
    assert.ok(out.includes("./f0.ts"));
    assert.ok(out.includes("truncated by slim-output"));
    assert.ok(out.split("\n").length < 150);
  });
  test("empty and tiny outputs passthrough", () => {
    assert.equal(slimOutput("", {}), "");
    assert.equal(slimOutput("ok", { command: "go test" }), "ok");
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
    assert.equal(collapsed, 0);
    assert.deepEqual(out, lines);
  });
});
