// Run: npm exec --yes tsx --test src/state/drawerStack.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { useDrawerStack } from "./drawerStack.ts";

function reset() {
  useDrawerStack.setState({ stack: [] });
}

test("push appends target to stack", () => {
  reset();
  useDrawerStack.getState().push({ kind: "card", cardId: "c1" });
  assert.deepEqual(useDrawerStack.getState().stack, [{ kind: "card", cardId: "c1" }]);
});

test("push twice produces depth 2", () => {
  reset();
  useDrawerStack.getState().push({ kind: "card", cardId: "c1" });
  useDrawerStack.getState().push({ kind: "article", articleId: "a1" });
  assert.equal(useDrawerStack.getState().stack.length, 2);
  assert.deepEqual(useDrawerStack.getState().stack[1], { kind: "article", articleId: "a1" });
});

test("pop removes top", () => {
  reset();
  useDrawerStack.getState().push({ kind: "card", cardId: "c1" });
  useDrawerStack.getState().push({ kind: "article", articleId: "a1" });
  useDrawerStack.getState().pop();
  assert.deepEqual(useDrawerStack.getState().stack, [{ kind: "card", cardId: "c1" }]);
});

test("pop on empty stack is a no-op", () => {
  reset();
  useDrawerStack.getState().pop();
  assert.deepEqual(useDrawerStack.getState().stack, []);
});

test("clear empties the stack", () => {
  reset();
  useDrawerStack.getState().push({ kind: "card", cardId: "c1" });
  useDrawerStack.getState().push({ kind: "article", articleId: "a1" });
  useDrawerStack.getState().clear();
  assert.deepEqual(useDrawerStack.getState().stack, []);
});

test("replaceTop swaps the top without changing depth", () => {
  reset();
  useDrawerStack.getState().push({ kind: "card", cardId: "c1" });
  useDrawerStack.getState().push({ kind: "article", articleId: "a1" });
  useDrawerStack.getState().replaceTop({ kind: "article", articleId: "a2" });
  assert.equal(useDrawerStack.getState().stack.length, 2);
  assert.deepEqual(useDrawerStack.getState().stack[1], { kind: "article", articleId: "a2" });
});
