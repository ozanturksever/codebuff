// US-003: Test for session message utility
import { describe, it, expect } from "bun:test";
import { sessionMessage } from "./session";

describe("sessionMessage", () => {
  it("should return a combined greeting and farewell message", () => {
    expect(sessionMessage("Alice")).toBe("Hello, Alice! Goodbye, Alice!");
  });

  it("should work with different names", () => {
    expect(sessionMessage("Bob")).toBe("Hello, Bob! Goodbye, Bob!");
    expect(sessionMessage("Charlie")).toBe("Hello, Charlie! Goodbye, Charlie!");
  });
});
