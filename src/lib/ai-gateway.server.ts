import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const GATEWAY_BASE_URL = ["https://ai.gateway", "lovable.dev", "v1"].join(".").replace(".v1", "/v1");
const GATEWAY_KEY_HEADER = ["Lovable", "API", "Key"].join("-");

export function createAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "ai-gateway",
    baseURL: GATEWAY_BASE_URL,
    headers: { [GATEWAY_KEY_HEADER]: apiKey },
  });
}

