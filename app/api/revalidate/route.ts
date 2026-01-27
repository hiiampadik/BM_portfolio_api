import { NextRequest, NextResponse } from "next/server";

// =============================================================================
// Types
// =============================================================================

interface SanityPayload {
  _type: string;
  slug?: {
    current?: string;
  };
  [key: string]: unknown;
}

interface RevalidationResult {
  path: string;
  ok: boolean;
  status?: number;
  error?: string;
}

interface ApiResponse {
  success: boolean;
  message: string;
  results?: RevalidationResult[];
  revalidatedPaths?: string[];
}

// =============================================================================
// Environment Configuration
// =============================================================================

function getEnvConfig() {
  return {
    apiGatewaySecret: process.env.API_GATEWAY_SECRET,
    mainSiteUrl: process.env.MAIN_SITE_URL,
    mainRevalidateEndpoint: process.env.MAIN_REVALIDATE_ENDPOINT,
    mainRevalidateSecret: process.env.MAIN_REVALIDATE_SECRET,
  };
}

// =============================================================================
// Path Mapping
// =============================================================================

/**
 * Maps Sanity document type and payload to paths that need revalidation.
 * Returns null if the type is not recognized.
 */
function getPathsToRevalidate(payload: SanityPayload): string[] | null {
  const { _type, slug } = payload;
  const slugValue = slug?.current;

  switch (_type) {
    case "exhibitions": {
      const paths = ["/cs/exhibitions", "/en/exhibitions", "/cs", "/en"];
      if (slugValue) {
        paths.unshift(
          `/exhibition/${slugValue}`,
          `/cs/exhibition/${slugValue}`,
          `/en/exhibition/${slugValue}`
        );
      }
      return paths;
    }

    case "pages": {
      const paths = ["/cs", "/en"];
      if (slugValue) {
        paths.unshift(`/${slugValue}`, `/cs/${slugValue}`, `/en/${slugValue}`);
      }
      return paths;
    }

    case "home":
    case "settings":
      return ["/", "/cs", "/en"];

    case "about":
      return ["/about", "/cs/about", "/en/about", "/cs", "/en"];

    case "contact":
      return ["/contact", "/cs/contact", "/en/contact", "/cs", "/en"];

    default:
      return null;
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates the Authorization header against API_GATEWAY_SECRET.
 */
function validateAuthorization(
  authHeader: string | null,
  secret: string
): boolean {
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === secret;
}

/**
 * Validates the Content-Type header is application/json.
 */
function validateContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.includes("application/json");
}

/**
 * Validates the timestamp for anti-replay protection.
 * Returns true if timestamp is within ±5 minutes or if not provided.
 */
function validateTimestamp(timestampHeader: string | null): boolean {
  if (!timestampHeader) {
    // If not provided, we allow the request (as per requirements)
    return true;
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    return false;
  }

  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;

  return Math.abs(now - timestamp) <= fiveMinutesMs;
}

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

  // slug is optional, but if present must have correct structure
  if (obj.slug !== undefined) {
    if (typeof obj.slug !== "object" || obj.slug === null) {
      return null;
    }
    const slugObj = obj.slug as Record<string, unknown>;
    if (
      slugObj.current !== undefined &&
      typeof slugObj.current !== "string"
    ) {
      return null;
    }
  }

  return obj as SanityPayload;
}

// =============================================================================
// Revalidation Logic
// =============================================================================

/**
 * Calls the main site's revalidation endpoint for a single path.
 */
async function revalidatePath(
  path: string,
  baseUrl: string,
  endpoint: string,
  secret: string
): Promise<RevalidationResult> {
  const url = `${baseUrl}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ path }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    return {
      path,
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    const errorMessage =
      error instanceof Error
        ? error.name === "AbortError"
          ? "Request timeout (10s)"
          : error.message
        : "Unknown error";

    return {
      path,
      ok: false,
      error: errorMessage,
    };
  }
}

/**
 * Revalidates all paths and returns results.
 */
async function revalidateAllPaths(
  paths: string[],
  baseUrl: string,
  endpoint: string,
  secret: string
): Promise<RevalidationResult[]> {
  const results = await Promise.all(
    paths.map((path) => revalidatePath(path, baseUrl, endpoint, secret))
  );

  return results;
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
    if (
      !config.apiGatewaySecret ||
      !config.mainSiteUrl ||
      !config.mainRevalidateEndpoint ||
      !config.mainRevalidateSecret
    ) {
      console.error(`[${requestId}] Missing required environment variables`);
      return errorResponse("Server configuration error", 500);
    }

    // Validate Content-Type
    const contentType = request.headers.get("content-type");
    if (!validateContentType(contentType)) {
      console.info(`[${requestId}] Invalid Content-Type: ${contentType}`);
      return errorResponse(
        "Unsupported Media Type. Expected application/json",
        415
      );
    }

    // Validate Authorization
    const authHeader = request.headers.get("authorization");
    if (!validateAuthorization(authHeader, config.apiGatewaySecret)) {
      console.info(`[${requestId}] Unauthorized request`);
      return errorResponse("Unauthorized", 401);
    }

    // Validate Timestamp (anti-replay)
    const timestampHeader = request.headers.get("x-request-timestamp");
    if (!validateTimestamp(timestampHeader)) {
      console.info(
        `[${requestId}] Invalid timestamp: ${timestampHeader}`
      );
      return errorResponse(
        "Invalid or expired timestamp. Must be within ±5 minutes.",
        400
      );
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      console.info(`[${requestId}] Invalid JSON body`);
      return errorResponse("Invalid JSON body", 400);
    }

    // Validate payload structure
    const payload = parseAndValidatePayload(body);
    if (!payload) {
      console.info(`[${requestId}] Invalid payload structure`);
      return errorResponse(
        "Invalid payload. Required: _type (string). Optional: slug.current (string)",
        400
      );
    }

    console.info(
      `[${requestId}] Processing revalidation for type: ${payload._type}, slug: ${payload.slug?.current ?? "N/A"}`
    );

    // Get paths to revalidate
    const paths = getPathsToRevalidate(payload);
    if (!paths) {
      console.info(`[${requestId}] Unknown document type: ${payload._type}`);
      return errorResponse(
        `Unknown document type: ${payload._type}`,
        400
      );
    }

    console.info(
      `[${requestId}] Revalidating ${paths.length} paths: ${paths.join(", ")}`
    );

    // Revalidate all paths
    const results = await revalidateAllPaths(
      paths,
      config.mainSiteUrl,
      config.mainRevalidateEndpoint,
      config.mainRevalidateSecret
    );

    // Analyze results
    const successfulPaths = results.filter((r) => r.ok);
    const failedPaths = results.filter((r) => !r.ok);

    // Log results
    if (failedPaths.length > 0) {
      console.error(
        `[${requestId}] Partial failure. Success: ${successfulPaths.length}, Failed: ${failedPaths.length}`
      );
      failedPaths.forEach((r) => {
        console.error(
          `[${requestId}] Failed: ${r.path} - ${r.error ?? `status ${r.status}`}`
        );
      });
    } else {
      console.info(
        `[${requestId}] All ${results.length} paths revalidated successfully`
      );
    }

    // Return appropriate response
    if (failedPaths.length === 0) {
      return jsonResponse(
        {
          success: true,
          message: `Successfully revalidated ${results.length} paths`,
          revalidatedPaths: paths,
        },
        200
      );
    }

    // Partial failure - return 207 Multi-Status
    return jsonResponse(
      {
        success: false,
        message: `Partial failure: ${successfulPaths.length}/${results.length} paths revalidated`,
        results,
      },
      207
    );
  } catch (error) {
    console.error(`[${requestId}] Unexpected error:`, error);
    return errorResponse("Internal server error", 500);
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
