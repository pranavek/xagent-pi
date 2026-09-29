# xagent (pi SDK) — Agent Instructions

Thin launcher over pi's own CLI (`main()` from `@earendil-works/pi-coding-agent`): same pi-tui interactive mode, print/json/rpc modes, `/model`, sessions, skills. Runs directly on Node ≥24 type stripping — no build step.

## Run / check
```bash
npm install
./src/cli.ts                 # interactive TUI (all pi flags work: -p, --model, --models, -c, ...)
npm run check                # tsc --noEmit
npm test                     # node --test src/
```

## Layout
- `src/cli.ts` — sets `PI_CODING_AGENT_DIR=~/.xagent/agent`, loads pi-claude-bridge via `-e`, appends `src/prompt.md`, registers inline extensions.
- `src/ollama.ts` — registers local Ollama models (`OLLAMA_HOST`, default localhost:11434) as `ollama/*`; thinking support comes from `/api/show` capabilities and maps pi levels to `reasoning_effort`.
- `src/web.ts` — `web_fetch` / `web_search` tools (Tavily if `TAVILY_API_KEY`, else DuckDuckGo).
- `src/route.ts` — virtual model `xagent/auto` (`pi.registerVirtualModel`): on each user message, classifies it with a local Laya server (`XAGENT_LAYA_URL`, default :8000) and routes to the easy/hard/max model. A second Laya question (`top`, normal/extreme) counts only when `route` says hard. Flags: `--route-easy`, `--route-hard`, `--route-max` (falls back to hard if unavailable), `--route-threshold`, `--route-max-threshold`. Tool follow-ups/retries stay on the turn's model; Laya down → last model (else hard).
- `src/prompt.md` — xagent prompt addendum (appended to pi's default prompt, not replacing it).

## Conventions
- pi must be imported *after* `PI_CODING_AGENT_DIR` is set (dynamic import in cli.ts).
- Config lives in `~/.xagent/agent` (auth.json, models.json, settings.json, sessions, mcp.json), isolated from `~/.pi`.
- MCP: pi built-in (`builtin:mcp`). Servers in `~/.xagent/agent/mcp.json` (global) or `.pi/mcp.json` (project, after trust); manage with `/mcp` or `xagent mcp add|remove|list`.
- Claude models via `claude-bridge/*` use the Claude Code subscription; as root, cli.ts sets `IS_SANDBOX=1`.
