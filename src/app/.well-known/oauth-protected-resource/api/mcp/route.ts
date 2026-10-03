import { corsPreflight } from "@/lib/oauth/http";
import { protectedResourceMetadataResponse } from "@/lib/oauth/metadata";

/**
 * RFC 9728 §3.1 path-suffixed location: clients try this one first when the
 * resource URL has a path component. Same document as the root location.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return protectedResourceMetadataResponse();
}

export function OPTIONS() {
  return corsPreflight();
}
