import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = async (hashStr: string, pw: string) => {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
};

const COMMON = new Set([
  "password1234", "123456789012", "qwertyuiop12", "letmein12345", "welcome12345",
  "passw0rd1234", "iloveyou1234", "admin1234567", "changeme1234", "password@123",
]);

export function passwordProblems(pw: string, email: string): string[] {
  const p: string[] = [];
  if (pw.length < 12) p.push("Use at least 12 characters.");
  if (pw.length > 128) p.push("Use at most 128 characters.");
  if (COMMON.has(pw.toLowerCase())) p.push("This password is too common.");
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) p.push("Do not include your email name.");
  if (new Set(pw).size < 6) p.push("Use more varied characters.");
  return p;
}
