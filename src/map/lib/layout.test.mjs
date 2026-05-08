// Run: npm exec --yes tsx --test src/map/lib/layout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { computeLayout } = await import("./layout.ts");

const dsl = {
  domains: [{ id: "d1", label: "领域一", display_order: 0 }],
  topics: [{ id: "t1", domain_id: "d1", label: "主题一", display_order: 0 }],
};

function card(card_id, entities) {
  return {
    card_id,
    article_id: `a-${card_id}`,
    title: card_id,
    description: null,
    entities,
    routing: "ai_curation",
    template: null,
    template_reason: null,
    card_date: "2026-05-06",
    read_at: null,
    queue_status: null,
    article_meta: {
      title: card_id,
      account: "",
      biz: null,
      author: null,
      publish_time: "2026-05-06",
      url: "",
    },
    topic: {
      id: "t1",
      label: "主题一",
      domain_id: "d1",
      domain_label: "领域一",
      domain_latin_label: null,
    },
  };
}

function readingCard(card_id, reading_minutes) {
  return {
    ...card(card_id, []),
    reading_minutes,
  };
}

test("duplicate card-pair routes keep separate entity lines with non-overlapping paths", () => {
  const layout = computeLayout(
    dsl,
    [
      card("c1", ["Entity A", "Entity B"]),
      card("c2", ["Entity A", "Entity B"]),
    ],
  );

  assert.equal(layout.routes.length, 2);
  assert.deepEqual(
    layout.routes.map((r) => r.shared_entities),
    [["Entity A"], ["Entity B"]],
  );
  assert.notEqual(layout.routes[0].path, layout.routes[1].path);
});

test("settlement layout uses visual radii to avoid dot overlap", () => {
  const layout = computeLayout(
    dsl,
    [
      readingCard("c1", 30),
      readingCard("c2", 20),
      readingCard("c3", 12),
      readingCard("c4", 8),
      readingCard("c5", 5),
      readingCard("c6", 2),
    ],
  );

  const settlements = layout.continents.flatMap((c) => c.cards);
  assert.equal(settlements.length, 6);
  for (let i = 0; i < settlements.length; i++) {
    for (let j = i + 1; j < settlements.length; j++) {
      const a = settlements[i];
      const b = settlements[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        d >= a.radius + b.radius + 2,
        `${a.card_id} and ${b.card_id} overlap: ${d} < ${a.radius + b.radius + 2}`,
      );
    }
  }
});
