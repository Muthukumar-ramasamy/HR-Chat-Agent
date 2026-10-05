// Runs before `npm run dev`: stops leftover API/UI processes from an earlier run that still
// hold the dev ports (on Windows, Ctrl+C can leave child processes behind). Only processes whose
// command line points into this project are stopped; anything else is reported and left alone.
const { execSync } = require("node:child_process");
const path = require("node:path");

const PORTS = [3001, 5173];
const projectDir = path.resolve(__dirname, "..").toLowerCase();

function listeners(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
      return [
        ...new Set(
          out
            .split(/\r?\n/)
            .filter((l) => /LISTENING/.test(l) && new RegExp(`[:.]${port}\\s`).test(l))
            .map((l) => Number(l.trim().split(/\s+/).pop())),
        ),
      ].filter(Boolean);
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" }).split("\n").map(Number).filter(Boolean);
  } catch {
    return []; // nothing listening (lsof exits non-zero)
  }
}

function commandLine(pid) {
  try {
    return process.platform === "win32"
      ? execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`, { encoding: "utf8" })
      : execSync(`ps -o command= -p ${pid}`, { encoding: "utf8" });
  } catch {
    return "";
  }
}

for (const port of PORTS) {
  for (const pid of listeners(port)) {
    const cmd = commandLine(pid).toLowerCase().replace(/\\/g, "/");
    if (cmd.includes(projectDir.replace(/\\/g, "/"))) {
      try {
        process.kill(pid);
        console.log(`[free-ports] stopped leftover process ${pid} on port ${port}`);
      } catch (e) {
        console.log(`[free-ports] could not stop ${pid} on port ${port}: ${e.message}`);
      }
    } else {
      console.log(`[free-ports] port ${port} is used by another program (PID ${pid}); not touching it`);
    }
  }
}
