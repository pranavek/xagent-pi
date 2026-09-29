import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import TurndownService from "turndown";

// Ported from the Go xagent (tools/webfetch.go, tools/websearch.go).

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript"]);

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const MAX_BODY = 2 * 1024 * 1024;

type Result = { title: string; url: string; desc: string };

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}\n\n... [truncated at ${max} chars]` : text;
}

export function formatResults(results: Result[]): string {
	if (results.length === 0) return "No results found.";
	return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.desc}`).join("\n\n");
}

// ponytail: regex over DuckDuckGo's html endpoint markup; breaks if DDG changes its classes.
export function parseDdg(html: string, n: number): Result[] {
	const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
	const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
	const results: Result[] = [];
	for (const [i, [, href, titleHtml]] of titles.entries()) {
		if (results.length >= n) break;
		let url = href.replaceAll("&amp;", "&");
		if (url.startsWith("//duckduckgo.com/l/")) url = new URL(`https:${url}`).searchParams.get("uddg") ?? url;
		const title = turndown.turndown(titleHtml).trim();
		const desc = snippets[i] ? turndown.turndown(snippets[i][1]).trim() : "";
		if (title && url) results.push({ title, url, desc });
	}
	return results;
}

async function readCapped(res: Response): Promise<string> {
	const buf = await res.arrayBuffer();
	return new TextDecoder().decode(buf.byteLength > MAX_BODY ? buf.slice(0, MAX_BODY) : buf);
}

const withTimeout = (signal: AbortSignal | undefined, ms: number) =>
	signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

const webFetch = defineTool({
	name: "web_fetch",
	label: "Web Fetch",
	description:
		"Fetch a URL and return its content as Markdown. HTML is converted; JSON/text returned as-is. Useful for reading documentation, GitHub issues, or any web page.",
	promptSnippet: "web_fetch: fetch a URL as Markdown",
	parameters: Type.Object({
		url: Type.String({ description: "URL to fetch." }),
		max_chars: Type.Optional(Type.Integer({ description: "Maximum characters to return (default 20000).", minimum: 1 })),
	}),
	async execute(_id, { url, max_chars = 20000 }, signal) {
		const res = await fetch(url, { headers: { "User-Agent": "xagent/1.0" }, signal: withTimeout(signal, 15000) });
		if (res.status >= 400) throw new Error(`web_fetch: HTTP ${res.status} from ${url}`);
		const body = await readCapped(res);
		const isHtml = res.headers.get("content-type")?.includes("text/html");
		return text(truncate(isHtml ? turndown.turndown(body) : body, max_chars));
	},
});

async function tavily(query: string, n: number, domains: string[] | undefined, key: string, signal?: AbortSignal) {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ api_key: key, query, max_results: n, search_depth: "basic", include_domains: domains }),
		signal: withTimeout(signal, 10000),
	});
	if (!res.ok) throw new Error(`web_search: tavily HTTP ${res.status}: ${await res.text()}`);
	const { results } = (await res.json()) as { results: { title: string; url: string; content: string }[] };
	return results.map((r) => ({ title: r.title, url: r.url, desc: r.content }));
}

async function ddg(query: string, n: number, signal?: AbortSignal) {
	const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
		headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" },
		signal: withTimeout(signal, 15000),
	});
	if (!res.ok) throw new Error(`web_search: ddg HTTP ${res.status}`);
	return parseDdg(await readCapped(res), n);
}

const webSearch = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the web and return titles, URLs, and content snippets. Use for current events, documentation, or anything not in training data. Backends (in priority order): Tavily (TAVILY_API_KEY), DuckDuckGo (zero-config fallback).",
	promptSnippet: "web_search: search the web for titles, URLs and snippets",
	parameters: Type.Object({
		query: Type.String({ description: "Search query." }),
		num_results: Type.Optional(Type.Integer({ description: "Number of results to return (default 5, max 10).", minimum: 1 })),
		include_domains: Type.Optional(
			Type.Array(Type.String(), {
				description: 'Restrict results to these domains, e.g. ["github.com", "docs.python.org"]. Tavily only.',
			}),
		),
	}),
	async execute(_id, { query, num_results = 5, include_domains }, signal) {
		const n = Math.min(num_results, 10);
		const key = process.env.TAVILY_API_KEY;
		const results = key ? await tavily(query, n, include_domains, key, signal) : await ddg(query, n, signal);
		return text(formatResults(results));
	},
});

export default function web(pi: ExtensionAPI) {
	pi.registerTool(webFetch);
	pi.registerTool(webSearch);
}
