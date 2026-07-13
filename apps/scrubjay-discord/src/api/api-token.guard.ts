import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { AppConfig } from "@/core/config/config.schema";
import { API_PATH_PREFIX } from "./api.constants";

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Fail-open outside /api/: /health and any future non-API route stay
    // reachable without a token. Everything under /api/ is guarded — including
    // controllers that forget the per-route @UseGuards decorator, since this
    // guard is also registered module-globally as an APP_GUARD.
    const path = request.originalUrl ?? request.url ?? "";
    if (!path.startsWith(API_PATH_PREFIX)) return true;

    const expected = this.configService.get("SCRUBJAY_API_TOKEN", {
      infer: true,
    });
    if (!expected) throw new UnauthorizedException();

    const token = this.extractTokenFromHeader(request);
    if (!token) throw new UnauthorizedException();

    // Constant-time compare of the presented bearer token against the
    // configured shared secret. Both are high-entropy secrets held in memory
    // (never hashed at rest), so a direct timingSafeEqual is appropriate; the
    // length guard only avoids timingSafeEqual's throw on unequal lengths.
    const presented = Buffer.from(token);
    const secret = Buffer.from(expected);
    if (
      presented.length !== secret.length ||
      !timingSafeEqual(presented, secret)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
