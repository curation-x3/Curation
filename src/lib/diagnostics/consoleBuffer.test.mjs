// Run: npm exec --yes tsx --test src/lib/diagnostics/consoleBuffer.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { createConsoleBuffer, serializeConsoleValue } = await import("./consoleBuffer.ts");

test("console diagnostics keeps a bounded newest-first exportable log", () => {
  const buffer = createConsoleBuffer({ limit: 2, now: () => "2026-05-08T00:00:00.000Z" });

  buffer.push("log", ["first"]);
  buffer.push("warn", ["second", { ok: true }]);
  buffer.push("error", ["third"]);

  const entries = buffer.entries();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.level), ["warn", "error"]);
  assert.equal(entries[0].message, 'second {"ok":true}');
  assert.equal(buffer.toText().includes("[warn] second {\"ok\":true}"), true);
  assert.equal(buffer.toJson().includes("\"level\": \"error\""), true);
});

test("console diagnostics serializes errors and circular objects safely", () => {
  const circular = { name: "root" };
  circular.self = circular;
  const error = new Error("boom");

  assert.equal(serializeConsoleValue(error).includes("Error: boom"), true);
  assert.equal(serializeConsoleValue(circular), '{"name":"root","self":"[Circular]"}');
});
