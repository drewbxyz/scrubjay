import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request, Response } from "express";
import { API_PATH_PREFIX } from "./api.constants";

/**
 * Renders every /api/* error as the contracts' `{ error: {...} }` envelope.
 *
 * Registered globally (via ApiModule's APP_FILTER) so it also catches errors
 * that never reach a controller: malformed JSON bodies (Express body-parser
 * 400s) and 404s for unknown /api/* paths. Requests outside /api/ — chiefly
 * /health — fall through to Nest's default error handling via `super.catch`.
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // Insurance against a double-send if streaming ever appears: once
    // headers are sent, only Nest's default handling may still act on the
    // response. Deliberately before any other branching so it holds
    // regardless of path.
    if (response.headersSent) {
      super.catch(exception, host);
      return;
    }

    // Only /api/* responses use the contracts' envelope; everything else
    // (notably /health) keeps Nest's default error shape.
    const path = request.originalUrl ?? request.url ?? "";
    if (!path.startsWith(API_PATH_PREFIX)) {
      super.catch(exception, host);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      response.status(status).json({
        error: {
          code:
            typeof payload.code === "string"
              ? payload.code
              : (HttpStatus[status] ?? "ERROR"),
          details: payload.details,
          message:
            typeof payload.message === "string"
              ? payload.message
              : exception.message,
        },
      });
      return;
    }

    // Client errors that bypass controllers — chiefly Express body-parser
    // failures (malformed JSON, oversized/unsupported bodies) — arrive as
    // http-errors carrying a numeric `status`/`statusCode`. Map those to the
    // matching envelope (a malformed JSON body becomes a 400 BAD_REQUEST)
    // instead of masking them as a 500.
    const clientStatus = clientErrorStatus(exception);
    if (clientStatus !== undefined) {
      response.status(clientStatus).json({
        error: {
          code: HttpStatus[clientStatus] ?? "ERROR",
          details: undefined,
          message: errorMessage(exception) ?? "Bad request",
        },
      });
      return;
    }

    this.logger.error(
      `${request.method} ${path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(500).json({
      error: {
        code: "INTERNAL",
        details: undefined,
        message: "Internal server error",
      },
    });
  }
}

/** 4xx status of an http-errors-style object, or undefined if it is not one. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== "object" || exception === null) {
    return undefined;
  }
  const candidate = exception as { status?: unknown; statusCode?: unknown };
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;
  return status !== undefined && status >= 400 && status < 500
    ? status
    : undefined;
}

function errorMessage(exception: unknown): string | undefined {
  const message = (exception as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
