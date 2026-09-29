import assert from "node:assert/strict";
import { test } from "node:test";
import { formatResults, parseDdg, truncate } from "./web.ts";

test("truncate", () => {
	assert.equal(truncate("abc", 5), "abc");
	assert.equal(truncate("abcdef", 3), "abc\n\n... [truncated at 3 chars]");
});

test("parseDdg unwraps redirect links and respects n", () => {
	const html = `
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpi.dev%2Fdocs&amp;rut=x">Pi <b>docs</b></a></h2>
<a class="result__snippet" href="x">The <b>pi</b> SDK &amp; more</a></div>
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://example.com/">Example</a></h2>
<a class="result__snippet" href="x">Second</a></div>`;
	assert.deepEqual(parseDdg(html, 5), [
		{ title: "Pi **docs**", url: "https://pi.dev/docs", desc: "The **pi** SDK & more" },
		{ title: "Example", url: "https://example.com/", desc: "Second" },
	]);
	assert.equal(parseDdg(html, 1).length, 1);
	assert.equal(formatResults([]), "No results found.");
});
