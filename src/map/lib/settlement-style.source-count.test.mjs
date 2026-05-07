// Run: npm exec --yes tsx --test src/map/lib/settlement-style.source-count.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { sourceCount } = await import("./settlement-style.ts");

test("aggregate card source count comes from source_card_ids", () => {
  assert.equal(
    sourceCount({ kind: "deduped", source_card_ids: ["s1", "s2", "s3"] }),
    3,
  );
});

test("plain card source count falls back to one", () => {
  assert.equal(sourceCount({ kind: "initial", source_card_ids: [] }), 1);
  assert.equal(sourceCount({ kind: "initial", source_card_ids: null }), 1);
});
