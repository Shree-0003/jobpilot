import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, totp, verifyTotp, generateSecret } from "@/lib/auth/totp";
import { UserCipher, newWrappedDek, safeEqual, sha256 } from "@/lib/crypto";

describe("TOTP (RFC 6238 / 4226)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("encodes the RFC secret", () => expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
  it("round-trips base32", () => expect(base32Decode(secret).toString()).toBe("12345678901234567890"));
  it("matches RFC 4226 HOTP vectors", () => {
    expect(hotp(secret, 0)).toBe("755224");
    expect(hotp(secret, 1)).toBe("287082");
    expect(hotp(secret, 9)).toBe("520489");
  });
  it("matches RFC 6238 at T=59s", () => expect(totp(secret, 59_000)).toBe("287082"));
  it("accepts ±1 step drift and rejects others", () => {
    const now = 1_000_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
  });
  it("generates 160-bit secrets", () => expect(base32Decode(generateSecret()).length).toBe(20));
});

describe("Envelope encryption", () => {
  const wrapped = newWrappedDek();
  const a = new UserCipher("user-a", wrapped);
  it("round-trips text and buffers", () => {
    expect(a.dec(a.enc("ISO 27001 Lead Auditor"))).toBe("ISO 27001 Lead Auditor");
    const buf = Buffer.from([0, 1, 2, 250]);
    expect(a.decBuffer(a.encBuffer(buf)).equals(buf)).toBe(true);
  });
  it("uses a fresh IV each time", () => expect(a.enc("x")).not.toBe(a.enc("x")));
  it("binds ciphertext to the user (AAD)", () => {
    const other = new UserCipher("user-b", wrapped);
    expect(() => other.dec(a.enc("secret"))).toThrow();
  });
  it("detects tampering", () => {
    const c = a.enc("salary 18 LPA").split(":");
    const ct = Buffer.from(c[3], "base64");
    ct[0] ^= 1;
    c[3] = ct.toString("base64");
    expect(() => a.dec(c.join(":"))).toThrow();
  });
  it("different users get different keys", () => {
    const b = new UserCipher("user-a", newWrappedDek());
    expect(() => b.dec(a.enc("x"))).toThrow();
  });
  it("helpers", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(sha256("a")).toHaveLength(64);
  });
});
