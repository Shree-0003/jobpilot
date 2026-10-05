import "server-only";
import crypto from "node:crypto";
import { env } from "./env";

/**
 * Envelope encryption.
 *  - MASTER_KEY (KEK) only wraps per-user data keys (DEKs); it never encrypts data directly.
 *  - Each user's DEK encrypts that user's sensitive fields and resume files (AES-256-GCM).
 *  - Deleting the wrapped DEK crypto-shreds everything encrypted under it.
 * The KeyProvider interface lets a Vault Transit / cloud KMS implementation replace the local KEK.
 */
export interface KeyProvider {
  wrap(dek: Buffer): string;
  unwrap(wrapped: string): Buffer;
}

const VERSION = "v1";

function aesEncrypt(key: Buffer, plaintext: Buffer, aad?: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const tag = c.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

function aesDecrypt(key: Buffer, payload: string, aad?: string): Buffer {
  const [v, ivB, tagB, ctB] = payload.split(":");
  if (v !== VERSION || !ivB || !tagB || ctB === undefined) throw new Error("Unsupported ciphertext");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB, "base64")), d.final()]);
}

export class LocalKeyProvider implements KeyProvider {
  constructor(private readonly kek: Buffer) {
    if (kek.length !== 32) throw new Error("KEK must be 32 bytes");
  }
  wrap(dek: Buffer) {
    return aesEncrypt(this.kek, dek, "dek");
  }
  unwrap(wrapped: string) {
    return aesDecrypt(this.kek, wrapped, "dek");
  }
}

let provider: KeyProvider | null = null;
export function keyProvider(): KeyProvider {
  if (!provider) provider = new LocalKeyProvider(Buffer.from(env().MASTER_KEY, "base64"));
  return provider;
}

export function newWrappedDek(): string {
  return keyProvider().wrap(crypto.randomBytes(32));
}

/** Per-user field cipher bound to that user's id as additional authenticated data. */
export class UserCipher {
  private readonly dek: Buffer;
  constructor(private readonly userId: string, wrappedDek: string) {
    this.dek = keyProvider().unwrap(wrappedDek);
  }
  enc(value: string): string {
    return aesEncrypt(this.dek, Buffer.from(value, "utf8"), this.userId);
  }
  dec(payload: string | undefined | null): string {
    if (!payload) return "";
    return aesDecrypt(this.dek, payload, this.userId).toString("utf8");
  }
  encBuffer(buf: Buffer): Buffer {
    return Buffer.from(aesEncrypt(this.dek, buf, this.userId + ":file"), "utf8");
  }
  decBuffer(buf: Buffer): Buffer {
    return aesDecrypt(this.dek, buf.toString("utf8"), this.userId + ":file");
  }
  encJson(v: unknown) {
    return this.enc(JSON.stringify(v));
  }
  decJson<T>(p: string | undefined): T | null {
    const s = this.dec(p);
    return s ? (JSON.parse(s) as T) : null;
  }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
export const newId = () => crypto.randomUUID();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
