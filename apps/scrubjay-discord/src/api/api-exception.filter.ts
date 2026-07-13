import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

/** Renders every api/v1 error as the contracts' `{ error: {...} }` envelope. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

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

    response.status(500).json({
      error: {
        code: "INTERNAL",
        details: undefined,
        message: "Internal server error",
      },
    });
  }
}
