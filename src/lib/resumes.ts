import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { env } from "./env";
import { randomToken, sha256 } from "./crypto";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Identify by content (magic bytes), never by filename or client-sent MIME type. */
export function inspectFile(buf: Buffer): { mime?: typeof PDF | typeof DOCX; problems: string[] } {
  const problems: string[] = [];
  if (buf.length === 0) return { problems: ["File is empty."] };
  if (buf.length > MAX_RESUME_BYTES) return { problems: ["File is larger than 5 MB."] };
  const head = buf.subarray(0, 8).toString("latin1");
  if (head.startsWith("%PDF-")) {
    const body = buf.toString("latin1");
    // Active content has no place in a resume.
    for (const [k, re] of [["JavaScript", /\/(JavaScript|JS)\b/], ["auto-launch action", /\/(Launch|OpenAction\s*<<[^>]*\/S\s*\/JavaScript)/], ["embedded file", /\/EmbeddedFile\b/], ["XFA form", /\/XFA\b/]] as const) {
      if (re.test(body)) problems.push(`PDF contains ${k}.`);
    }
    return { mime: PDF, problems };
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const names = buf.toString("latin1");
    if (!names.includes("[Content_Types].xml") || !names.includes("word/")) return { problems: ["ZIP file is not a Word document."] };
    if (/vbaProject\.bin|\.docm|macroEnabled/i.test(names)) problems.push("Document contains macros.");
    if (/word\/embeddings\//.test(names)) problems.push("Document contains embedded objects.");
    if (/attachedTemplate|TargetMode="External"/.test(names)) problems.push("Document references external content.");
    return { mime: DOCX, problems };
  }
  return { problems: ["Only PDF or DOCX files are accepted."] };
}

/** Optional ClamAV scan over clamd's INSTREAM protocol. Returns null when not configured. */
export async function clamScan(buf: Buffer): Promise<{ clean: boolean; detail: string } | null> {
  const hostPort = env().CLAMAV_HOST;
  if (!hostPort) return null;
  const [host, portStr] = hostPort.split(":");
  return new Promise((resolve) => {
    const sock = net.connect(Number(portStr || 3310), host);
    let out = "";
    sock.setTimeout(15_000, () => { sock.destroy(); resolve({ clean: false, detail: "ClamAV timeout" }); });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
    sock.on("data", (d) => (out += d.toString()));
    sock.on("end", () => resolve({ clean: /OK\0?$/.test(out.trim()), detail: out.replace(/\0/g, "").trim() }));
    sock.on("error", () => resolve({ clean: false, detail: "ClamAV unreachable" }));
  });
}

function storageDir() {
  return path.resolve(env().STORAGE_DIR, "resumes");
}

/** Random object key; the original filename is never used on disk. */
export async function storeEncrypted(encrypted: Buffer): Promise<string> {
  const key = randomToken(18).replace(/[^A-Za-z0-9_-]/g, "");
  await fs.mkdir(storageDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(storageDir(), `${key}.bin`), encrypted, { mode: 0o600, flag: "wx" });
  return key;
}

function objectPath(key: string) {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(key)) throw new Error("Bad object key");
  return path.join(storageDir(), `${key}.bin`);
}

export const readEncrypted = (key: string) => fs.readFile(objectPath(key));
export const deleteObject = (key: string) => fs.rm(objectPath(key), { force: true });
export const fileHash = (b: Buffer) => sha256(b);
export const purgeAllObjects = async (keys: string[]) => Promise.all(keys.map(deleteObject));
