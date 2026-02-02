/**
 * LLM Proxy client for streaming requests.
 * Handles SSE parsing for both Anthropic and OpenAI response formats.
 */

import { isBillingError } from "./respond.js";

const LLM_PROXY_URL =
  process.env.LLM_PROXY_URL || "http://localhost:3001";
const LLM_PROXY_API_KEY = process.env.LLM_PROXY_API_KEY;

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequestOptions {
  model?: string;
  maxTokens?: number;
  messages: LlmMessage[];
}

export interface LlmResponse {
  ok: true;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface LlmErrorResponse {
  ok: false;
  error: string;
  isBillingError: boolean;
  statusCode?: number;
}

export type LlmResult = LlmResponse | LlmErrorResponse;

/**
 * Call the LLM Proxy with streaming and return the complete response.
 */
export async function callLlmProxy(
  options: LlmRequestOptions,
): Promise<LlmResult> {
  const {
    model = "claude-haiku-4-5-20251001",
    maxTokens = 4096,
    messages,
  } = options;

  try {
    const response = await fetch(`${LLM_PROXY_URL}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_PROXY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      let errorMessage = `LLM request failed: ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // Ignore JSON parse errors
      }

      return {
        ok: false,
        error: errorMessage,
        isBillingError:
          response.status === 402 || isBillingError(errorMessage),
        statusCode: response.status,
      };
    }

    // Parse the SSE stream
    const result = await parseSSEStream(response);
    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: errorMessage,
      isBillingError: isBillingError(errorMessage),
    };
  }
}

/**
 * Parse an SSE stream response from the LLM Proxy.
 * Handles both Anthropic and OpenAI response formats.
 */
async function parseSSEStream(response: Response): Promise<LlmResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      error: "No response body",
      isBillingError: false,
    };
  }

  const decoder = new TextDecoder();
  let content = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        if (line === "data: [DONE]") continue;

        try {
          const data = JSON.parse(line.slice(6));

          // Anthropic format: content_block_delta
          if (data.type === "content_block_delta" && data.delta?.text) {
            content += data.delta.text;
          }

          // Anthropic format: simple delta
          if (data.delta?.text && !data.type) {
            content += data.delta.text;
          }

          // Anthropic format: message_delta with usage
          if (data.type === "message_delta" && data.usage) {
            outputTokens = data.usage.output_tokens;
          }

          // Anthropic format: message_start with usage
          if (data.type === "message_start" && data.message?.usage) {
            inputTokens = data.message.usage.input_tokens;
          }

          // OpenAI format: choices[0].delta.content
          if (data.choices?.[0]?.delta?.content) {
            content += data.choices[0].delta.content;
          }

          // OpenAI format: usage in final message
          if (data.usage) {
            inputTokens = data.usage.prompt_tokens;
            outputTokens = data.usage.completion_tokens;
          }
        } catch {
          // Not valid JSON, skip this line
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith("data: ") && buffer !== "data: [DONE]") {
      try {
        const data = JSON.parse(buffer.slice(6));
        if (data.delta?.text) {
          content += data.delta.text;
        }
        if (data.choices?.[0]?.delta?.content) {
          content += data.choices[0].delta.content;
        }
      } catch {
        // Ignore
      }
    }

    return {
      ok: true,
      content,
      usage:
        inputTokens !== undefined || outputTokens !== undefined
          ? { inputTokens, outputTokens }
          : undefined,
    };
  } finally {
    reader.releaseLock();
  }
}
