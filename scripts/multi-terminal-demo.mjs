#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");
const agentDir = resolve(root, "node-agent");

function sh(cmd, args, opts = {}) {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => {
        if (code !== 0) {
            console.error(`[demo] '${cmd} ${args.join(" ")}' exited with code`, code);
        }
    });
    return p;
}

function ensureDir(p) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function start() {
    // Prepare data dirs
    ensureDir(resolve(agentDir, "data-node1"));
    ensureDir(resolve(agentDir, "data-node2"));
    ensureDir(resolve(agentDir, "data-node3"));

    console.log("[demo] Starting Node-1 (HTTP :9890), Node-2 (HTTP :9891) and Node-3 (HTTP :9892)...");

    // Windows spawn requires .exe or .cmd for executables, and sometimes full path or shell: true
    const isWin = process.platform === "win32";
    const agentBin = isWin ? "node-agent.exe" : "./node-agent";

    const node1 = spawn(
        agentBin, ["-name", "Node-1", "-data-dir", "./data-node1", "-http", "127.0.0.1:9890"], { cwd: agentDir, stdio: "inherit", shell: isWin }
    );

    const node2 = spawn(
        agentBin, ["-name", "Node-2", "-data-dir", "./data-node2", "-http", "127.0.0.1:9891"], { cwd: agentDir, stdio: "inherit", shell: isWin }
    );

    const node3 = spawn(
        agentBin, ["-name", "Node-3", "-data-dir", "./data-node3", "-http", "127.0.0.1:9892"], { cwd: agentDir, stdio: "inherit", shell: isWin }
    );

    console.log("[demo] Starting optional Relay Node-4 (HTTP :9893)...");
    const node4 = spawn(
        agentBin, ["-name", "Relay-4", "-data-dir", "./data-node4", "-http", "127.0.0.1:9893"], { cwd: agentDir, stdio: "inherit", shell: isWin }
    );

    console.log("[demo] Starting UIs on :5183, :5184 and :5185...");
    // On Windows, npm is a batch file, so we need shell: true or npm.cmd
    const npmBin = isWin ? "npm.cmd" : "npm";

    const ui1 = spawn(
        npmBin, ["run", "dev", "--", "--port", "5183"], {
            cwd: root,
            stdio: "inherit",
            shell: isWin,
            env: {...process.env, VITE_NODE_AGENT_URL: "http://127.0.0.1:9890" }
        }
    );

    const ui2 = spawn(
        npmBin, ["run", "dev", "--", "--port", "5184"], {
            cwd: root,
            stdio: "inherit",
            shell: isWin,
            env: {...process.env, VITE_NODE_AGENT_URL: "http://127.0.0.1:9891" }
        }
    );

    const ui3 = spawn(
        npmBin, ["run", "dev", "--", "--port", "5185"], {
            cwd: root,
            stdio: "inherit",
            shell: isWin,
            env: {...process.env, VITE_NODE_AGENT_URL: "http://127.0.0.1:9892" }
        }
    );

    process.on("SIGINT", () => {
        console.log("\n[demo] Shutting down...");
        [node1, node2, node3, node4, ui1, ui2, ui3].forEach((p) => p && p.kill("SIGINT"));
        setTimeout(() => process.exit(0), 500);
    });
}

const cmd = process.argv[2] || "start";
if (cmd === "start") {
    start();
} else {
    console.log("Usage: node scripts/multi-terminal-demo.mjs start");
}