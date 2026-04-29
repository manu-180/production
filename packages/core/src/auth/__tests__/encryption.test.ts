import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../encryption.js";

const VALID_KEY = "a".repeat(64);

describe("encrypt / decrypt", () => {
  it("roundtrip: decrypt returns original plaintext", () => {
    const plaintext = "hello conductor";
    const { ciphertext, iv, tag } = encrypt(plaintext, VALID_KEY);
    expect(decrypt(ciphertext, iv, tag, VALID_KEY)).toBe(plaintext);
  });

  it("different IVs: same plaintext produces different ciphertext each time", () => {
    const { ciphertext: c1, iv: iv1 } = encrypt("same input", VALID_KEY);
    const { ciphertext: c2, iv: iv2 } = encrypt("same input", VALID_KEY);
    expect(iv1).not.toBe(iv2);
    expect(c1).not.toBe(c2);
  });

  it("invalid key (too short) throws expected error on encrypt", () => {
    expect(() => encrypt("data", "deadbeef")).toThrow(
      "Invalid encryption key: must be 32 bytes hex",
    );
  });

  it("invalid key (too short) throws expected error on decrypt", () => {
    const { ciphertext, iv, tag } = encrypt("data", VALID_KEY);
    expect(() => decrypt(ciphertext, iv, tag, "deadbeef")).toThrow(
      "Invalid encryption key: must be 32 bytes hex",
    );
  });

  it("tampered ciphertext causes decrypt to throw", () => {
    const { ciphertext, iv, tag } = encrypt("sensitive", VALID_KEY);
    const buf = Buffer.from(ciphertext, "base64");
    // XOR first byte to corrupt the ciphertext without changing buffer length
    buf.writeUInt8(buf.readUInt8(0) ^ 0xff, 0);
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered, iv, tag, VALID_KEY)).toThrow();
  });

  it("tampered tag causes decrypt to throw", () => {
    const { ciphertext, iv, tag } = encrypt("sensitive", VALID_KEY);
    const buf = Buffer.from(tag, "base64");
    buf.writeUInt8(buf.readUInt8(0) ^ 0xff, 0);
    const tampered = buf.toString("base64");
    expect(() => decrypt(ciphertext, iv, tampered, VALID_KEY)).toThrow();
  });

  it("unicode roundtrip: emojis and accented characters survive encrypt/decrypt", () => {
    const plaintext = "Héllo wörld 🔐 conductör";
    const { ciphertext, iv, tag } = encrypt(plaintext, VALID_KEY);
    expect(decrypt(ciphertext, iv, tag, VALID_KEY)).toBe(plaintext);
  });
});
