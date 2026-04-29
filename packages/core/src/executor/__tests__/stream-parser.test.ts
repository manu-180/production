import { describe, expect, it } from "vitest";
import { StreamParser } from "../stream-parser.js";

describe("StreamParser", () => {
  it("returns null for empty lines", () => {
    const p = new StreamParser();
    expect(p.feed("")).toBeNull();
    expect(p.feed("   ")).toBeNull();
    expect(p.feed("\t\t")).toBeNull();
  });

  it("parses a system init event", () => {
    const p = new StreamParser();
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-123",
      tools: ["Read", "Edit"],
      cwd: "/work",
      model: "claude-sonnet-4-7",
    });
    const ev = p.feed(line);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe("system");
    if (ev?.type === "system") {
      expect(ev.session_id).toBe("sess-123");
      expect(ev.tools).toEqual(["Read", "Edit"]);
      expect(ev.cwd).toBe("/work");
      expect(ev.model).toBe("claude-sonnet-4-7");
    }
  });

  it("parses an assistant event", () => {
    const p = new StreamParser();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    const ev = p.feed(line);
    expect(ev?.type).toBe("assistant");
    if (ev?.type === "assistant") {
      expect(ev.message.id).toBe("msg_1");
      expect(ev.message.usage.input_tokens).toBe(10);
      expect(ev.message.content[0]?.type).toBe("text");
    }
  });

  it("returns parse_error for invalid JSON", () => {
    const p = new StreamParser();
    const ev = p.feed("not json {[");
    expect(ev?.type).toBe("parse_error");
    if (ev?.type === "parse_error") {
      expect(ev.raw).toBe("not json {[");
    }
  });

  it("returns parse_error for valid JSON failing schema", () => {
    const p = new StreamParser();
    const ev = p.feed(JSON.stringify({ type: "system", subtype: "init" }));
    expect(ev?.type).toBe("parse_error");
  });

  it("handles multi-event feeds via feedChunk", () => {
    const p = new StreamParser();
    const a = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "s1",
      tools: [],
      cwd: "/",
      model: "m",
    });
    const b = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 100,
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const events = p.feedChunk(`${a}\n${b}\n`);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("system");
    expect(events[1]?.type).toBe("result");
  });

  it("buffers incomplete lines across chunks", () => {
    const p = new StreamParser();
    const json = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "s1",
      tools: [],
      cwd: "/",
      model: "m",
    });
    const half1 = json.slice(0, 20);
    const half2 = `${json.slice(20)}\n`;
    expect(p.feedChunk(half1)).toEqual([]);
    const events = p.feedChunk(half2);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("system");
  });

  it("flushes remaining buffer", () => {
    const p = new StreamParser();
    const json = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "s1",
      tools: [],
      cwd: "/",
      model: "m",
    });
    p.feedChunk(json);
    const flushed = p.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.type).toBe("system");
  });

  it("tolerates extra whitespace", () => {
    const p = new StreamParser();
    const line = `   ${JSON.stringify({
      type: "error",
      message: "oops",
    })}   `;
    const ev = p.feed(line);
    expect(ev?.type).toBe("error");
  });
});
