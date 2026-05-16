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
 * Returns true when the given pid corresponds to a currently-running
 * process on this host. Used to identify TRULY orphaned claude.exe
 * processes — those whose worker parent has already exited.
 *
 * On all platforms `process.kill(pid, 0)` is the standard "is alive"
 * probe: signal 0 performs the permission check without delivering a
 * signal. It throws ESRCH when the pid is gone and EPERM when the pid
 * exists but we lack permission (which still means it exists). Anything
 * else (or a successful return) → alive.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Kills claude processes left over from a previous worker crash — i.e.
 * those whose parent process is no longer alive. Previously this
 * indiscriminately killed every claude.exe on the host, which also took
 * out:
 *   - sibling worker instances on the same machine
 *   - the user's manual `claude` CLI sessions in other terminals
 *   - any IDE plugin that spawns claude.exe
 *
 * Filtering by parent liveness keeps the original recovery intent (clean
 * up after a crashed worker) without collateral damage. The trade-off:
 * a claude.exe whose parent is a different live process is left alone,
 * even if it's truly stuck — but those can be killed manually and this
 * function is supposed to be a safety net, not a hammer.
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

  const orphans = procs.filter((p) => !isProcessAlive(p.parentPid));
  const skipped = procs.length - orphans.length;
  if (orphans.length === 0) {
    logger.info(
      { totalSeen: procs.length, skipped },
      "orphan-cleanup.none_truly_orphaned (parents alive)",
    );
    return { found: procs.length, killed: 0 };
  }

  logger.warn(
    {
      total: procs.length,
      orphans: orphans.length,
      skipped,
      orphanPids: orphans.map((p) => p.pid),
    },
    "orphan-cleanup.found_orphans",
  );

  let killed = 0;
  for (const p of orphans) {
    const ok = await killProcessTree(p.pid);
    if (ok) killed += 1;
    logger.info({ pid: p.pid, parentPid: p.parentPid, killed: ok }, "orphan-cleanup.kill_attempt");
  }

  return { found: procs.length, killed };
}
