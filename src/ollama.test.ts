import assert from "node:assert/strict";
import { test } from "node:test";
import { toModel } from "./ollama.ts";

test("toModel enables reasoning only for thinking-capable models", () => {
	const thinking = toModel("gemma4:e4b", ["completion", "tools", "thinking"]);
	assert.equal(thinking.reasoning, true);
	assert.equal(thinking.thinkingLevelMap?.off, "none");
	assert.equal(thinking.thinkingLevelMap?.xhigh, "high");

	const plain = toModel("llama3:8b", ["completion", "tools"]);
	assert.equal(plain.reasoning, false);
	assert.equal("thinkingLevelMap" in plain, false);
	assert.equal(toModel("x", []).reasoning, false);
});
