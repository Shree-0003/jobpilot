import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017"),
  MONGODB_DB: z.string().min(1).default("jobpilot"),
  MASTER_KEY: z.string().min(1, "MASTER_KEY is required (openssl rand -base64 32)"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  STORAGE_DIR: z.string().default("./storage"),
  CLAMAV_HOST: z.string().optional().default(""),
  GMAIL_IMAP_USER: z.string().optional().default(""),
  GMAIL_IMAP_APP_PASSWORD: z.string().optional().default(""),
  ADZUNA_APP_ID: z.string().optional().default(""),
  ADZUNA_APP_KEY: z.string().optional().default(""),
  DISCOVERY_INTERVAL_HOURS: z.coerce.number().min(0).max(48).default(4),
  DISCOVERY_MAX_NEW_PER_RUN: z.coerce.number().int().min(1).max(200).default(30),
  MCP_GMAIL_COMMAND: z.string().optional().default(""),
  MCP_GMAIL_ARGS: z.string().optional().default(""),
  MCP_GMAIL_SEARCH_TOOL: z.string().default("search_emails"),
  MCP_GMAIL_READ_TOOL: z.string().default("read_email"),
  MCP_GMAIL_QUERY: z.string().default("from:(jobalerts-noreply@linkedin.com OR naukri.com) newer_than:7d"),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Never print values, only which keys are wrong.
      const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid environment configuration: ${keys}`);
    }
    const key = Buffer.from(parsed.data.MASTER_KEY, "base64");
    if (key.length !== 32) throw new Error("MASTER_KEY must decode to exactly 32 bytes");
    cached = parsed.data;
  }
  return cached;
}
