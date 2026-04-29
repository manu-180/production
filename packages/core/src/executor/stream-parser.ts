import {
  type ClaudeStreamEvent,
  type ParseErrorEvent,
  claudeStreamEventSchema,
} from "./event-types.js";

export class StreamParser {
  private buffer = "";

  feed(line: string): ClaudeStreamEvent | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return makeParseError(trimmed);
    }

    const result = claudeStreamEventSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    return makeParseError(trimmed);
  }

  feedChunk(chunk: string): ClaudeStreamEvent[] {
    const events: ClaudeStreamEvent[] = [];
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const event = this.feed(line);
      if (event !== null) events.push(event);
      newlineIndex = this.buffer.indexOf("\n");
    }
    return events;
  }

  flush(): ClaudeStreamEvent[] {
    const events: ClaudeStreamEvent[] = [];
    if (this.buffer.length > 0) {
      const remaining = this.buffer;
      this.buffer = "";
      const event = this.feed(remaining);
      if (event !== null) events.push(event);
    }
    return events;
  }

  reset(): void {
    this.buffer = "";
  }
}

function makeParseError(raw: string): ParseErrorEvent {
  return { type: "parse_error", raw };
}
