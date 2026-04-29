import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClaudeProcess } from "../claude-process.js";
import { isResultEvent, isSystemInitEvent } from "../event-types.js";

const RUN_INTEGRATION = process.env["CONDUCTOR_RUN_INTEGRATION"] === "true";

describe("ClaudeProcess (integration)", () => {
  it.skipIf(!RUN_INTEGRATION)(
    "spawns a real claude CLI and streams events end-to-end",
    async () => {
      const proc = new ClaudeProcess(
        {
          prompt: "Say hello in one word.",
          workingDir: tmpdir(),
          permissionMode: "default",
          maxTurns: 1,
          timeoutMs: 60_000,
        },
        process.env,
      );

      await proc.start();

      let sawSystem = false;
      let sawResult = false;
      for await (const ev of proc.events()) {
        if (isSystemInitEvent(ev)) sawSystem = true;
        if (isResultEvent(ev)) sawResult = true;
      }

      const result = await proc.wait();

      expect(sawSystem).toBe(true);
      expect(sawResult).toBe(true);
      expect(result.sessionId.length).toBeGreaterThan(0);
      expect(["success", "error"]).toContain(result.finalStatus);
    },
    120_000,
  );
});
