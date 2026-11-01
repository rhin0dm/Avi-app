import "server-only";
// Provider-neutral text completion. Swap or add providers here without
// touching the rest of the app. Keys are read only on the server.

export type CompletionRequest = { system: string; user: string; maxTokens?: number };
export interface AiProvider {
  name: string;
  model: string;
  complete(req: CompletionRequest): Promise<string>;
}

const TIMEOUT_MS = 55_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function anthropic(apiKey: string, model: string): AiProvider {
  return {
    name: "anthropic",
    model,
    async complete({ system, user, maxTokens = 2000 }) {
      const data = await postJson(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] },
      );
      return (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    },
  };
}

function openai(apiKey: string, model: string): AiProvider {
  return {
    name: "openai",
    model,
    async complete({ system, user, maxTokens = 2000 }) {
      const data = await postJson(
        "https://api.openai.com/v1/chat/completions",
        { authorization: `Bearer ${apiKey}` },
        {
          model, max_completion_tokens: maxTokens, response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        },
      );
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

/** Returns null when no provider is configured — callers must degrade gracefully. */
export function getProvider(): AiProvider | null {
  const which = (process.env.AI_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "")).toLowerCase();
  if (which === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return anthropic(process.env.ANTHROPIC_API_KEY, process.env.AI_MODEL || "claude-sonnet-5-5");
  }
  if (which === "openai" && process.env.OPENAI_API_KEY) {
    if (!process.env.AI_MODEL) return null; // OpenAI model name must be chosen explicitly
    return openai(process.env.OPENAI_API_KEY, process.env.AI_MODEL);
  }
  return null;
}

export function providerStatus() {
  const p = getProvider();
  return p ? { configured: true, provider: p.name, model: p.model } : { configured: false, provider: null, model: null };
}
