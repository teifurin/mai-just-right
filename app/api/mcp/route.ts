import { handleMcpRequest } from '../../../server/http-handler.mjs';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handleMcpRequest(request, {
    MCD_MCP_TOKEN: process.env.MCD_MCP_TOKEN,
    MCD_ALLOW_LOCAL: process.env.MCD_ALLOW_LOCAL,
    MCD_TRUST_SITES_IDENTITY: process.env.MCD_TRUST_SITES_IDENTITY,
    MCD_OWNER_USER_ID: process.env.MCD_OWNER_USER_ID,
    MCD_PICKUP_PROFILE_JSON: process.env.MCD_PICKUP_PROFILE_JSON,
  });
}
