// Provider-neutral LLM interface. Ollama is the default; OpenAI/Anthropic/Gemini adapters
// implement the same two methods and are selected in lib/ai/index.ts.

export interface ChatResult {
  content: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ChatRequest {
  system: string;
  user: string;
  /** JSON Schema for structured output; omit for free text. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  constructor(private readonly baseUrl: string, readonly model: string, private readonly timeoutMs: number, private readonly fetchImpl: typeof fetch = fetch) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          ...(req.schema ? { format: req.schema } : {}),
          options: { temperature: 0, num_ctx: 8192, num_predict: req.maxTokens ?? 1024 },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      const j = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      return { content: j.message?.content ?? "", tokensIn: j.prompt_eval_count, tokensOut: j.eval_count };
    } finally {
      clearTimeout(t);
    }
  }

  async health() {
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = (await res.json()) as { models?: { name: string }[] };
      const has = (j.models ?? []).some((m) => m.name === this.model || m.name.startsWith(this.model + ":") || m.name === `${this.model}:latest`);
      return has ? { ok: true, detail: `${this.model} ready` } : { ok: false, detail: `Model ${this.model} not pulled (run: ollama pull ${this.model})` };
    } catch {
      return { ok: false, detail: "Ollama not reachable" };
    }
  }
}
