// Run: npm exec --yes -- tsx --test src/lib/platform/sync-policy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSyncSince } from "./sync-policy.ts";

test("resolveSyncSince ignores an advanced cursor until the local cache is bootstrapped", () => {
  assert.equal(
    resolveSyncSince({
      lastSyncTs: "2026-05-08T05:16:13.437257+00:00",
      localVisibleCardCount: 0,
      bootstrapComplete: false,
    }),
    null,
  );
});

test("resolveSyncSince keeps the cursor once an empty cache has been bootstrapped", () => {
  assert.equal(
    resolveSyncSince({
      lastSyncTs: "2026-05-08T05:16:13.437257+00:00",
      localVisibleCardCount: 0,
      bootstrapComplete: true,
    }),
    "2026-05-08T05:16:13.437257+00:00",
  );
});

test("resolveSyncSince keeps the cursor when visible cards are already present", () => {
  assert.equal(
    resolveSyncSince({
      lastSyncTs: "2026-05-08T05:16:13.437257+00:00",
      localVisibleCardCount: 12,
      bootstrapComplete: false,
    }),
    "2026-05-08T05:16:13.437257+00:00",
  );
});
