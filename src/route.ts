import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Virtual model `xagent/auto`: for each user message, ask a local Laya server whether the request
// is easy or hard, then run it on the matching model. Select it with `--model xagent/auto` or /model.
// Needs `laya-serve` running (see README; start it with LAYA_MODELS=english to avoid an OOM kill).
// Tool follow-ups and retries stay on the model that answered the turn.

const QUESTIONS = {
	route: {
		type: "choice",
		instructions: "Does this request to a coding assistant need a strong model?",
		criteria: {
			easy: "a quick question, definition, lookup, greeting, or small one-line edit",
			hard: "multi-step coding, debugging, refactoring, architecture design, or in-depth research",
		},
	},
	// Only consulted once `route` says hard: on its own this question is noisy ("hi" scores 0.76).
	top: {
		type: "choice",
		instructions: "How large is this task?",
		criteria: {
			normal: "a question, a small change, or work within one file or component",
			extreme: "large cross-cutting design or architecture, security-critical review, or hard debugging across many components",
		},
	},
};

export type Tier = "easy" | "hard" | "max";
export interface Scores {
	hard: number;
	extreme: number;
}

// `extreme` only counts when the request is already hard.
export function pickTier({ hard, extreme }: Scores, hardAt: number, maxAt: number): Tier {
	if (hard < hardAt) return "easy";
	return extreme >= maxAt ? "max" : "hard";
}

export function splitRef(ref: string): [provider: string, id: string] | undefined {
	const i = ref.indexOf("/");
	return i > 0 && i < ref.length - 1 ? [ref.slice(0, i), ref.slice(i + 1)] : undefined;
}

export function lastUserText(messages: readonly Message[]): string {
	const content = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
	if (typeof content === "string") return content;
	return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

async function classify(url: string, text: string, signal: AbortSignal | undefined): Promise<Scores> {
	const res = await fetch(`${url}/v1/systemone`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ state: text.slice(0, 4000), questions: QUESTIONS }),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const { answers } = (await res.json()) as {
		answers: { route: { probabilities: Record<string, number> }; top?: { probabilities: Record<string, number> } };
	};
	return { hard: answers.route.probabilities.hard ?? 0, extreme: answers.top?.probabilities.extreme ?? 0 };
}

export default function route(pi: ExtensionAPI) {
	pi.registerFlag("route-easy", { type: "string", description: "Model for easy prompts (default: first ollama/* model)" });
	pi.registerFlag("route-hard", { type: "string", default: "claude-bridge/claude-sonnet-5-5", description: "Model for hard prompts" });
	pi.registerFlag("route-max", { type: "string", default: "claude-bridge/claude-opus-5-5", description: "Model for the hardest prompts (falls back to --route-hard if unavailable)" });
	pi.registerFlag("route-threshold", { type: "string", default: "0.5", description: "P(hard) at or above which the hard model is used" });
	pi.registerFlag("route-max-threshold", { type: "string", default: "0.85", description: "P(extreme) at or above which a hard prompt uses the max model" });

	const layaUrl = (process.env.XAGENT_LAYA_URL ?? "http://localhost:8000").replace(/\/$/, "");

	const FLAG = { easy: "route-easy", hard: "route-hard", max: "route-max" } as const;
	const find = (tier: Tier, ctx: ExtensionContext) => {
		const ref = pi.getFlag(FLAG[tier]) as string | undefined;
		const parts = ref ? splitRef(ref) : undefined;
		return parts
			? ctx.modelRegistry.find(...parts)
			: ctx.modelRegistry.getAvailable().find((m) => m.provider === "ollama");
	};
	const modelFor = (tier: Tier, ctx: ExtensionContext) => {
		// No access to the max model (e.g. no Opus) is not an error: use the hard one.
		const model = find(tier, ctx) ?? (tier === "max" ? find("hard", ctx) : undefined);
		if (!model) throw new Error(`auto-route: no available model for ${tier} (${pi.getFlag(FLAG[tier]) ?? "first ollama/*"})`);
		return model;
	};

	pi.registerVirtualModel<{ tier: Tier }>({
		provider: "xagent",
		id: "auto",
		name: "Auto (easy/hard/max via Laya)",
		// The selected level is passed through to the chosen model, which clamps it.
		thinkingLevels: ["off", "low", "medium", "high"],
		async route(request, ctx) {
			const sticky = request.failed ?? request.previous;
			// Tool follow-ups and retries keep the turn's model. So do compaction summaries ("direct"):
			// they read the whole conversation, which may not fit the easy model's smaller window.
			if (request.reason === "direct") {
				return { model: request.previous?.model ?? modelFor("hard", ctx), thinkingLevel: "off" };
			}
			if (request.reason !== "user" && sticky) {
				return { model: sticky.model, thinkingLevel: sticky.thinkingLevel ?? request.thinkingLevel };
			}
			let tier: Tier;
			try {
				const hardAt = Number(pi.getFlag("route-threshold")) || 0.5;
				const maxAt = Number(pi.getFlag("route-max-threshold")) || 0.85;
				tier = pickTier(await classify(layaUrl, lastUserText(request.messages), request.signal), hardAt, maxAt);
			} catch (err) {
				// Router down must never block a prompt: stay on the last model, else use the strong one.
				ctx.ui.notify(`auto-route: Laya unreachable at ${layaUrl} (${(err as Error).message})`, "warning");
				if (request.previous) return { model: request.previous.model, thinkingLevel: request.thinkingLevel };
				tier = "hard";
			}
			return { model: modelFor(tier, ctx), thinkingLevel: request.thinkingLevel, state: { tier } };
		},
	});
}
