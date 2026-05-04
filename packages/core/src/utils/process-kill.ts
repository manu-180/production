import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

const TASKKILL_TIMEOUT_MS = 5_000;
const TASKLIST_TIMEOUT_MS = 3_000;

/**
 * Verifica si un PID está vivo en Windows. Retorna true si vivo, false si muerto.
 * Si la consulta falla (timeout, error), retorna `null` (desconocido).
 */
export async function isPidAliveWindows(pid: number): Promise<boolean | null> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
      { windowsHide: true, timeout: TASKLIST_TIMEOUT_MS },
    );
    // Si encuentra: línea CSV con el proceso; si no: línea "INFO: No tasks..."
    return new RegExp(`^"[^"]+","${pid}"`, "m").test(stdout);
  } catch (err) {
    logger.warn({ err, pid }, "process-kill.is_pid_alive_failed");
    return null;
  }
}

/**
 * Mata el árbol de procesos en Windows con verificación.
 * Estrategia:
 *  1. taskkill /T /F /PID <pid> y esperar exit code
 *  2. Verificar con tasklist que efectivamente murió
 *  3. Si sigue vivo, fallback a PowerShell Stop-Process -Force -Id <pid>
 *  4. Verificar de nuevo. Si sigue vivo, log level=error.
 *
 * Retorna:
 *  - "killed": confirmado muerto
 *  - "already_dead": tasklist no lo encuentra
 *  - "still_alive": ambos métodos fallaron, sigue vivo
 *  - "unknown": no se pudo verificar
 */
export type KillTreeResult = "killed" | "already_dead" | "still_alive" | "unknown";

export async function killProcessTreeWindowsVerified(pid: number): Promise<KillTreeResult> {
  if (!Number.isInteger(pid) || pid <= 0) return "already_dead";

  // Step 1: taskkill /T /F
  let taskkillOk = false;
  try {
    await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      timeout: TASKKILL_TIMEOUT_MS,
    });
    taskkillOk = true;
  } catch (err) {
    logger.warn({ err, pid }, "process-kill.taskkill_failed");
  }

  // Step 2: verify
  const aliveAfterTaskkill = await isPidAliveWindows(pid);
  if (aliveAfterTaskkill === false) {
    logger.info({ pid, taskkillOk }, "process-kill.verified_dead");
    return taskkillOk ? "killed" : "already_dead";
  }

  // Step 3: fallback to PowerShell
  logger.warn({ pid }, "process-kill.fallback_powershell");
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Stop-Process -Force -Id ${pid} -ErrorAction SilentlyContinue`],
      { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
    );
  } catch (err) {
    logger.error({ err, pid }, "process-kill.powershell_failed");
  }

  // Step 4: re-verify
  const finalAlive = await isPidAliveWindows(pid);
  if (finalAlive === false) {
    return "killed";
  }
  if (finalAlive === true) {
    logger.error({ pid }, "process-kill.still_alive_after_all_attempts");
    return "still_alive";
  }
  return "unknown";
}
