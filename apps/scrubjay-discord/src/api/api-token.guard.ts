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
import { isPublicPath, requestPathname } from "./api.constants";

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Default-closed: only allowlisted public paths (PUBLIC_PATHS, e.g.
    // /health) skip auth. Everything else — every /api/ route, unknown paths,
    // and case variants like /API/... (Express routes case-insensitively) —
    // requires the bearer token. This guard is global when ApiModule is
    // registered (APP_GUARD), so it also covers controllers that forget the
    // per-route @UseGuards decorator. New public routes MUST be added to the
    // PUBLIC_PATHS allowlist explicitly.
    if (isPublicPath(requestPathname(request))) return true;

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
