import { corsPreflight } from "@/lib/oauth/http";
import { protectedResourceMetadataResponse } from "@/lib/oauth/metadata";

export const dynamic = "force-dynamic";

export function GET() {
  return protectedResourceMetadataResponse();
}

export function OPTIONS() {
  return corsPreflight();
}
