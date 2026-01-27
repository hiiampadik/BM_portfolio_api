import { NextRequest, NextResponse } from "next/server";
import { isValidSignature, SIGNATURE_HEADER_NAME } from "@sanity/webhook";

// =============================================================================
// Types
// =============================================================================

interface SanityPayload {
  _type: string;
  slug?: string;
  [key: string]: unknown;
}

interface RevalidationResult {
  success: boolean;
  revalidatedTags?: string[];
  error?: string;
}

interface ApiResponse {
  success: boolean;
  message: string;
  revalidatedTags?: string[];
  error?: string;
}

// =============================================================================
// Environment Configuration
// =============================================================================

function getEnvConfig() {
  return {
    apiGatewaySecret: process.env.API_GATEWAY_SECRET,
    mainSiteRevalidateUrl: process.env.MAIN_SITE_REVALIDATE_URL,
  };
}

// =============================================================================
// Tag Mapping
// =============================================================================

/**
 * Maps Sanity document type and payload to tags that need revalidation.
 * Returns null if the type is not recognized.
 */
function getTagsToRevalidate(payload: SanityPayload): string[] | null {
  const { _type, slug } = payload;

  switch (_type) {
    case "projects": {
      const tags = ["projects"];
      if (slug) {
        tags.push(`project-${slug}`);
      }
      return tags;
    }

    case "about":
      return ["about"];

    case "home":
      return ["home"];

    case "settings":
      return ["settings"];

    case "contact":
      return ["contact"];

    default:
      return null;
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Safely parses and validates the Sanity webhook payload.
 */
function parseAndValidatePayload(body: unknown): SanityPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const obj = body as Record<string, unknown>;

  // _type is required and must be a string
  if (typeof obj._type !== "string" || obj._type.trim() === "") {
    return null;
  }

  // slug is optional, but if present must be a string
  if (obj.slug !== undefined && typeof obj.slug !== "string") {
    return null;
  }

  return obj as SanityPayload;
}

// =============================================================================
// Revalidation Logic
// =============================================================================

/**
 * Calls the main site's revalidation endpoint with tags.
 */
async function revalidateTags(
  tags: string[],
  revalidateUrl: string,
  secret: string
): Promise<RevalidationResult> {
  try {
    const response = await fetch(revalidateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ tags }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `Main site returned ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      revalidatedTags: result.revalidatedTags ?? tags,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// =============================================================================
// Response Helpers
// =============================================================================

function jsonResponse(data: ApiResponse, status: number): NextResponse {
  return NextResponse.json(data, { status });
}

function errorResponse(message: string, status: number): NextResponse {
  return jsonResponse({ success: false, message }, status);
}

// =============================================================================
// Route Handlers
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    // Get environment configuration
    const config = getEnvConfig();

    // Validate environment variables
    if (!config.apiGatewaySecret || !config.mainSiteRevalidateUrl) {
      console.error(`[${requestId}] Missing required environment variables`);
      return errorResponse("Server configuration error", 200);
    }

    // Get raw body for signature validation
    const rawBody = await request.text();

    // Validate Sanity webhook signature
    const signature = request.headers.get(SIGNATURE_HEADER_NAME);
    if (!signature || !isValidSignature(rawBody, signature, config.apiGatewaySecret)) {
      console.info(`[${requestId}] Invalid signature`);
      return errorResponse("Invalid signature", 401);
    }

    // Parse request body
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.info(`[${requestId}] Invalid JSON body`);
      return errorResponse("Invalid JSON body", 400);
    }

    // Validate payload structure
    const payload = parseAndValidatePayload(body);
    if (!payload) {
      console.info(`[${requestId}] Invalid payload structure`);
      return errorResponse(
        "Invalid payload. Required: _type (string). Optional: slug (string)",
        400
      );
    }

    console.info(
      `[${requestId}] Processing revalidation for type: ${payload._type}, slug: ${payload.slug ?? "N/A"}`
    );

    // Get tags to revalidate
    const tags = getTagsToRevalidate(payload);
    if (!tags) {
      console.info(`[${requestId}] Unknown document type: ${payload._type}`);
      return errorResponse(`Unknown document type: ${payload._type}`, 400);
    }

    console.info(`[${requestId}] Revalidating tags: ${tags.join(", ")}`);

    // Revalidate tags on main site
    const result = await revalidateTags(
      tags,
      config.mainSiteRevalidateUrl,
      config.apiGatewaySecret
    );

    if (!result.success) {
      console.error(`[${requestId}] Revalidation failed: ${result.error}`);
      return jsonResponse(
        {
          success: false,
          message: "Revalidation failed",
          error: result.error,
        },
        200
      );
    }

    console.info(
      `[${requestId}] Successfully revalidated tags: ${result.revalidatedTags?.join(", ")}`
    );

    return jsonResponse(
      {
        success: true,
        message: `Successfully revalidated ${tags.length} tag(s)`,
        revalidatedTags: result.revalidatedTags,
      },
      200
    );
  } catch (error) {
    console.error(`[${requestId}] Unexpected error:`, error);
    return errorResponse("Internal server error", 200);
  }
}

// Handle unsupported methods
export async function GET(): Promise<NextResponse> {
  return errorResponse("Method Not Allowed. Use POST.", 405);
}

export async function PUT(): Promise<NextResponse> {
  return errorResponse("Method Not Allowed. Use POST.", 405);
}

export async function DELETE(): Promise<NextResponse> {
  return errorResponse("Method Not Allowed. Use POST.", 405);
}

export async function PATCH(): Promise<NextResponse> {
  return errorResponse("Method Not Allowed. Use POST.", 405);
}
