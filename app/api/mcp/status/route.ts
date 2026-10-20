import { mcpStatus } from '../../../../server/http-handler.mjs';

export const dynamic = 'force-dynamic';
export async function GET() {
  return mcpStatus({ MCD_MCP_TOKEN: process.env.MCD_MCP_TOKEN });
}
