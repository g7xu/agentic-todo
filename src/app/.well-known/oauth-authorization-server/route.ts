import { corsPreflight } from "@/lib/oauth/http";
import { authorizationServerMetadataResponse } from "@/lib/oauth/metadata";

export const dynamic = "force-dynamic";

export function GET() {
  return authorizationServerMetadataResponse();
}

export function OPTIONS() {
  return corsPreflight();
}
