import { apiErrorSchema } from "@scrubjay/api-contracts";
import type { z } from "zod";
import { env } from "./env";
import { meter } from "./telemetry";

export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(`${code}: ${message}`);
    this.name = "BotApiError";
  }
}

export interface BotApiRequest {
  body?: unknown;
  /** Logical name used as a metric attribute, e.g. "subscriptions.list". */
  endpoint: string;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  /** Path + query on the bot API, e.g. "/api/v1/guilds". */
  path: string;
}

const requests = meter.createCounter("scrubjay_portal_bot_api_requests", {
  description: "Portal server -> bot API requests",
  unit: "{request}",
});
const duration = meter.createHistogram("scrubjay_portal_bot_api_duration", {
  description: "Portal server -> bot API request duration",
  unit: "ms",
});

function record(
  endpoint: string,
  method: string,
  status: string,
  startedAt: number,
): void {
  // Attribute names deliberately avoid the Prometheus-reserved `job`/`instance`
  // and carry no Discord IDs (logical endpoint names only — cardinality).
  const attributes = { endpoint, method, status };
  requests.add(1, attributes);
  duration.record(performance.now() - startedAt, attributes);
}

export function toQuery(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

export async function botApi<T>(
  schema: z.ZodType<T>,
  req: BotApiRequest,
): Promise<T> {
  const { BOT_API_URL, SCRUBJAY_API_TOKEN } = env();
  const method = req.method ?? "GET";
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(new URL(req.path, BOT_API_URL), {
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      headers: {
        authorization: `Bearer ${SCRUBJAY_API_TOKEN}`,
        ...(req.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      method,
    });
  } catch (cause) {
    record(req.endpoint, method, "network_error", startedAt);
    throw new BotApiError(
      502,
      "BOT_UNREACHABLE",
      "bot API is unreachable",
      cause,
    );
  }
  record(req.endpoint, method, String(response.status), startedAt);

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new BotApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
      );
    }
    throw new BotApiError(
      response.status,
      "UPSTREAM",
      `bot API returned ${response.status}`,
    );
  }

  const body = schema.safeParse(await response.json());
  if (!body.success) {
    throw new BotApiError(
      502,
      "CONTRACT_MISMATCH",
      "bot API response failed contract validation",
    );
  }
  return body.data;
}
