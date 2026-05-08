// Run: node --import tsx --test src/lib/readingMetrics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { formatReadingMinutes, formatReadingSummary } = await import("./readingMetrics.ts");

test("formatReadingMinutes hides missing or zero values", () => {
  assert.equal(formatReadingMinutes(undefined), "");
  assert.equal(formatReadingMinutes(0), "");
});

test("formatReadingMinutes renders minutes", () => {
  assert.equal(formatReadingMinutes(7), "7 分钟");
});

test("formatReadingSummary renders word count and minutes", () => {
  assert.equal(formatReadingSummary(2450, 7), "约 2450 字 · 7 分钟");
});
