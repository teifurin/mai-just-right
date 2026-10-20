import { handleMcpRequest } from '../../../server/http-handler.mjs';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handleMcpRequest(request, {
    MCD_MCP_TOKEN: process.env.MCD_MCP_TOKEN,
    MCD_ALLOW_LOCAL: process.env.MCD_ALLOW_LOCAL,
  });
}
