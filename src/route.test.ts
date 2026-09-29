import assert from "node:assert/strict";
import { test } from "node:test";
import { lastUserText, pickTier, splitRef } from "./route.ts";

test("pickTier: hard gate first, then extreme decides max", () => {
	assert.equal(pickTier({ hard: 0.3, extreme: 0.9 }, 0.5, 0.85), "easy"); // "hi" scored extreme 0.76 alone
	assert.equal(pickTier({ hard: 0.56, extreme: 0.38 }, 0.5, 0.85), "hard");
	assert.equal(pickTier({ hard: 0.79, extreme: 0.82 }, 0.5, 0.85), "hard");
	assert.equal(pickTier({ hard: 0.63, extreme: 0.96 }, 0.5, 0.85), "max");
	assert.equal(pickTier({ hard: 0.56, extreme: 0.38 }, 0.6, 0.85), "easy");
	assert.equal(pickTier({ hard: 0, extreme: 0 }, 0.5, 0.85), "easy");
});

test("splitRef splits on the first slash only", () => {
	assert.deepEqual(splitRef("ollama/gemma4:e4b"), ["ollama", "gemma4:e4b"]);
	assert.deepEqual(splitRef("openrouter/meta/llama"), ["openrouter", "meta/llama"]);
	assert.equal(splitRef("sonnet"), undefined);
	assert.equal(splitRef("ollama/"), undefined);
});

test("lastUserText takes the latest user message, string or blocks", () => {
	const msgs = [
		{ role: "user", content: "first" },
		{ role: "assistant", content: [] },
		{ role: "user", content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] },
		{ role: "toolResult" },
	] as never;
	assert.equal(lastUserText(msgs), "a\nb");
	assert.equal(lastUserText([] as never), "");
});
