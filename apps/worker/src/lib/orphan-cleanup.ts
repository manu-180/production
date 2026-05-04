import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@conductor/core";

const execFileAsync = promisify(execFile);

interface ClaudeProcess {
  pid: number;
  parentPid: number;
  commandLine: string;
}

/**
 * Lists all claude.exe (Win) or claude (Linux/macOS) processes on the machine.
 * Returns [] if none found or if the query fails.
 */
export async function listClaudeProcesses(): Promise<ClaudeProcess[]> {
  if (process.platform === "win32") {
    return listWindows();
  }
  return listUnix();
}

async function listWindows(): Promise<ClaudeProcess[]> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(
      (p: {
        ProcessId: number;
        ParentProcessId: number;
        CommandLine: string | null;
      }) => ({
        pid: p.ProcessId,
        parentPid: p.ParentProcessId,
        commandLine: p.CommandLine ?? "",
      }),
    );
  } catch (err) {
    logger.warn({ err }, "orphan-cleanup.list_windows.failed");
    return [];
  }
}

async function listUnix(): Promise<ClaudeProcess[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,ppid,comm,args"], {
      timeout: 10_000,
    });
    const lines = stdout.split("\n").slice(1);
    const processes: ClaudeProcess[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) continue;
      const [, pid, ppid, comm, args] = match;
      if (comm === "claude" || args?.includes("claude")) {
        processes.push({
          pid: Number(pid),
          parentPid: Number(ppid),
          commandLine: args ?? "",
        });
      }
    }
    return processes;
  } catch (err) {
    logger.warn({ err }, "orphan-cleanup.list_unix.failed");
    return [];
  }
}

/**
 * Kills the process (and its tree on Windows). Returns true if the kill
 * command was launched, false on error or invalid pid.
 */
export async function killProcessTree(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        timeout: 5_000,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Kills all detected claude processes at startup. Runs once only — assumes
 * that if the worker just started, no legitimate claude process should exist.
 * Manual CLI usage from another terminal will also be killed (documented
 * trade-off: worker and manual CLI must not coexist).
 */
export async function cleanupOrphanClaudeProcesses(): Promise<{
  found: number;
  killed: number;
}> {
  const procs = await listClaudeProcesses();
  if (procs.length === 0) {
    logger.info({}, "orphan-cleanup.none_found");
    return { found: 0, killed: 0 };
  }

  logger.warn(
    { count: procs.length, pids: procs.map((p) => p.pid) },
    "orphan-cleanup.found_orphans",
  );

  let killed = 0;
  for (const p of procs) {
    const ok = await killProcessTree(p.pid);
    if (ok) killed += 1;
    logger.info({ pid: p.pid, parentPid: p.parentPid, killed: ok }, "orphan-cleanup.kill_attempt");
  }

  return { found: procs.length, killed };
}
