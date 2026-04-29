import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface EncryptResult {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encrypt(plaintext: string, keyHex: string): EncryptResult {
  if (keyHex.length !== 64) {
    throw new Error("Invalid encryption key: must be 32 bytes hex");
  }

  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(ciphertext: string, iv: string, tag: string, keyHex: string): string {
  if (keyHex.length !== 64) {
    throw new Error("Invalid encryption key: must be 32 bytes hex");
  }

  try {
    const key = Buffer.from(keyHex, "hex");
    const ivBuf = Buffer.from(iv, "base64");
    const tagBuf = Buffer.from(tag, "base64");
    const ciphertextBuf = Buffer.from(ciphertext, "base64");

    const decipher = createDecipheriv(ALGORITHM, key, ivBuf, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tagBuf);

    return Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]).toString("utf8");
  } catch (err) {
    throw new Error(`Decryption failed: ${(err as Error).message}`);
  }
}
