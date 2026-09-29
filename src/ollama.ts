import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// pi thinking levels → Ollama's OpenAI-compatible `reasoning_effort` (none/low/medium/high).
export const THINKING_LEVEL_MAP = {
	off: "none",
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "high",
	max: "high",
};

export function toModel(id: string, capabilities: string[]) {
	const reasoning = capabilities.includes("thinking");
	return {
		id,
		name: id,
		reasoning,
		...(reasoning && { thinkingLevelMap: THINKING_LEVEL_MAP }),
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		// ponytail: fixed 32k window; Ollama's served num_ctx is a server setting, not in /api/show.
		// Override per model in ~/.xagent/agent/models.json.
		contextWindow: 32768,
		maxTokens: 8192,
	};
}

async function capabilities(host: string, model: string): Promise<string[]> {
	try {
		const res = await fetch(`${host}/api/show`, {
			method: "POST",
			body: JSON.stringify({ model }),
			signal: AbortSignal.timeout(2000),
		});
		return res.ok ? (((await res.json()) as { capabilities?: string[] }).capabilities ?? []) : [];
	} catch {
		return []; // unknown → treated as non-thinking, same as before
	}
}

// Registers every locally pulled Ollama model as `ollama/<name>` so it shows up in /model.
export default async function ollama(pi: ExtensionAPI) {
	const host = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
	let names: string[];
	try {
		const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		names = ((await res.json()) as { models: { name: string }[] }).models.map((m) => m.name);
	} catch (err) {
		console.error(`xagent: Ollama not reachable at ${host} (${(err as Error).message}); skipping`);
		return;
	}
	if (names.length === 0) return;
	const caps = await Promise.all(names.map((n) => capabilities(host, n)));
	pi.registerProvider("ollama", {
		name: "Ollama",
		baseUrl: `${host}/v1`,
		api: "openai-completions",
		apiKey: "ollama",
		models: names.map((id, i) => toModel(id, caps[i])),
	});
}
