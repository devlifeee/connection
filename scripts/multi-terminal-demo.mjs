import { spawn } from "node:child_process";
import { platform } from "node:os";

function runWinNode({ http, p2p, data, fe }) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ".\\scripts\\run-node.ps1",
    "-HttpPort",
    String(http),
    "-P2PPort",
    String(p2p),
    "-DataDir",
    data,
    "-FrontendPort",
    String(fe),
  ];
  const p = spawn("powershell", args, { stdio: "inherit", shell: false });
  return p;
}

function main() {
  const cmd = process.argv[2] || "start";
  if (cmd !== "start") {
    console.error("Usage: node scripts/multi-terminal-demo.mjs start");
    process.exit(1);
  }

  const isWin = platform() === "win32";

  if (!isWin) {
    console.error("This launcher is intended for Windows. Use scripts in scripts/*.sh on Unix.");
    process.exit(1);
  }

  const procs = [
    runWinNode({ http: 9876, p2p: 4001, data: "data", fe: 8080 }),
    runWinNode({ http: 9877, p2p: 4002, data: "data1", fe: 8081 }),
    runWinNode({ http: 9878, p2p: 4003, data: "data2", fe: 8082 }),
  ];

  function shutdown() {
    for (const p of procs) {
      try {
        p.kill();
      } catch {}
    }
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();

