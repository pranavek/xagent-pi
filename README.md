# xagent

A terminal coding agent built on the [pi SDK](https://pi.dev/docs/latest/sdk). You pick from Claude Code models or local Ollama models, and it comes with web search/fetch and MCP support (`/mcp`, `xagent mcp add`).

```bash
npm install
./src/cli.ts        # or `npm link` once, then `xagent`
```

Use `/model` to switch models. See `xagent --help` for all options. Config lives in `~/.xagent/agent`.

## Auto model routing (optional)
`xagent/auto` is a virtual model in `/model`. For each message you send, it asks [Laya](https://huggingface.co/blog/sora-2/laya-ai-model-how-it-works-run-it-locally-and-eval), a small local classifier, whether the request is easy, hard, or among the hardest. Easy ones run on a local model, hard ones on Sonnet, and the hardest on Opus. The footer shows the choice, e.g. `auto → claude-opus-5-5`. Tool calls within a turn stay on the same model, and if Laya is down the last model is kept.

**Setup** (Python, ~5 GB of disk for torch):
```bash
python3 -m venv ~/.xagent/laya && ~/.xagent/laya/bin/pip install "laya[serve]"
LAYA_MODELS=english LAYA_MAX_LOADED=1 ~/.xagent/laya/bin/laya-serve &   # listens on :8000, ~2.5 GB RAM
```
By default `laya-serve` loads all three checkpoints (~1.2B parameters), which can exhaust memory and get killed with `SIGKILL`. `LAYA_MODELS=english` loads only the one xagent needs.

**Examples**
```bash
# defaults: easy → first ollama/* model, hard → claude-sonnet-5-5, hardest → claude-opus-5-5
xagent --model xagent/auto

# choose the models
xagent --model xagent/auto --route-easy ollama/qwen3.5:9b --route-hard claude-bridge/claude-sonnet-5-5 --route-max claude-bridge/claude-opus-5-5

# send fewer prompts to Opus (default 0.85; lower = more Opus)
xagent --model xagent/auto --route-max-threshold 0.95

# keep more prompts local: use the hard model only when P(hard) >= 0.7
xagent --model xagent/auto --route-easy ollama/qwen3.5:9b --route-threshold 0.7

# one-shot, with Laya on another host
XAGENT_LAYA_URL=http://gpu-box:8000 xagent --model xagent/auto -p "what does ls -la do?"
```

| Prompt | Result |
|---|---|
| `what does ls -la do?` | easy (0.24) → local |
| `summarize README.md` | easy (0.23) → local |
| `Debug why the TUI viewport clips on resize and fix it across the renderer and model` | hard (0.79) → Sonnet |
| `Design a multi-tenant rate limiter for our Kong gateway, implement it, and threat-model it` | hardest (0.96) → Opus |

The Opus tier is a second Laya question that only counts once the first says hard. Its 0.85 default was tuned on nine sample prompts, so adjust `--route-max-threshold` to taste. If the max model isn't available, hard prompts use `--route-hard` instead.

Laya reads the whole message, so a trailing instruction like "reply only with OK" can push a hard request to easy (0.79 → 0.30). The thinking level you pick is passed to whichever model is chosen. Switching models between messages loses the prompt cache.
