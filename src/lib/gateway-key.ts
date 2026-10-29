/**
 * Credential for the AI/email gateway.
 * Reads AI_GATEWAY_KEY, falling back to the legacy variable name so existing
 * deployments keep working while the secret is renamed.
 */
export function getGatewayKey(): string | undefined {
  return process.env.AI_GATEWAY_KEY ?? process.env.LOVABLE_API_KEY;
}
