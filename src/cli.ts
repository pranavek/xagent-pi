#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ollama from "./ollama.ts";
import route from "./route.ts";
import web from "./web.ts";

// Must be set before pi is imported: it resolves the agent dir at load time.
process.env.PI_CODING_AGENT_DIR ??= join(homedir(), ".xagent", "agent");
// ponytail: pi-claude-bridge hardcodes bypassPermissions and Claude Code refuses that as root
// unless IS_SANDBOX=1. Only meant for containers; unset it on a real host.
if (process.getuid?.() === 0) process.env.IS_SANDBOX ??= "1";

const here = dirname(fileURLToPath(import.meta.url));
// Path lookup, not require.resolve: these packages' "exports" hide package.json.
const extensionEntry = (pkg: string) => {
	const dir = join(here, "..", "node_modules", pkg);
	return join(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).pi.extensions[0]);
};

const args = process.argv.slice(2);
// pi dispatches these on args[0], so they must reach main() unprefixed (e.g. `xagent mcp add ...`).
const SUBCOMMANDS = new Set(["install", "uninstall", "remove", "update", "list", "config", "mcp"]);

const { main } = await import("@earendil-works/pi-coding-agent");
await main(
	SUBCOMMANDS.has(args[0])
		? args
		: ["-e", extensionEntry("pi-claude-bridge"), "--append-system-prompt", join(here, "prompt.md"), ...args],
	{ extensionFactories: [{ name: "ollama", factory: ollama }, { name: "web", factory: web }, { name: "auto-route", factory: route }] },
);
