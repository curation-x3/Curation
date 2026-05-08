import { describe, it, expect } from "vitest";
import { pickShape, baseRadius, ringCount, starPath, trianglePath } from "../settlement-style";

const baseCard = {
  card_id: "c1",
  article_id: "a1",
  routing: "ai_curation" as const,
  entities: [],
} as any;

describe("pickShape", () => {
  it("favorited → star (highest priority)", () => {
    expect(pickShape({ ...baseCard, card_id: null, routing: null }, true)).toBe("star");
    expect(pickShape({ ...baseCard, routing: "original_content_with_pre_card" }, true)).toBe("star");
    expect(pickShape({ ...baseCard }, true)).toBe("star");
  });
  it("no card_id → triangle (2nd priority)", () => {
    expect(pickShape({ ...baseCard, card_id: null, routing: null }, false)).toBe("triangle");
    expect(pickShape({ ...baseCard, card_id: null, routing: "ai_curation" }, false)).toBe("triangle");
  });
  it("ai_curation → circle-rust", () => {
    expect(pickShape({ ...baseCard, routing: "ai_curation" }, false)).toBe("circle-rust");
  });
  it("original_content_with_pre_card → circle-vellum", () => {
    expect(pickShape({ ...baseCard, routing: "original_content_with_pre_card" }, false))
      .toBe("circle-vellum");
  });
  it("original_content_with_post_card → circle-vellum", () => {
    expect(pickShape({ ...baseCard, routing: "original_content_with_post_card" }, false))
      .toBe("circle-vellum");
  });
  it("null routing with card_id → fallback circle-rust", () => {
    expect(pickShape({ ...baseCard, routing: null }, false)).toBe("circle-rust");
  });
});

describe("baseRadius", () => {
  it("1 min ≈ 4.2", () => expect(baseRadius(1)).toBeCloseTo(4.2, 1));
  it("5 min ≈ 6.9", () => expect(baseRadius(5)).toBeCloseTo(6.9, 1));
  it("10 min ≈ 9.0", () => expect(baseRadius(10)).toBeCloseTo(9.0, 1));
  it("caps at 13", () => expect(baseRadius(100)).toBe(13));
  it("floors at 2", () => expect(baseRadius(0)).toBe(2));
  it("undefined → treated as 1 min", () => expect(baseRadius(undefined)).toBeCloseTo(4.2, 1));
});

describe("ringCount", () => {
  it("undefined → 0", () => expect(ringCount(undefined)).toBe(0));
  it("1 → 0", () => expect(ringCount(1)).toBe(0));
  it("2 → 1", () => expect(ringCount(2)).toBe(1));
  it("3 → 2", () => expect(ringCount(3)).toBe(2));
  it("5 → 4 (cap)", () => expect(ringCount(5)).toBe(4));
  it("100 → 4 (cap)", () => expect(ringCount(100)).toBe(4));
  it("0 → 0 (no negative rings)", () => expect(ringCount(0)).toBe(0));
});

describe("path helpers", () => {
  it("starPath produces a closed M..Z path", () => {
    const p = starPath(10);
    expect(p.startsWith("M")).toBe(true);
    expect(p.endsWith(" Z")).toBe(true);
    // 5-point star = 10 points + close
    expect(p.split("L").length).toBe(10);
  });
  it("trianglePath produces 3-point closed path", () => {
    const p = trianglePath(10);
    expect(p.startsWith("M")).toBe(true);
    expect(p.endsWith(" Z")).toBe(true);
    expect(p.split("L").length).toBe(3);
  });
});
