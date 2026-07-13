import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { AppConfig } from "@/core/config/config.schema";

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get("SCRUBJAY_API_TOKEN", {
      infer: true,
    });
    if (!expected) throw new UnauthorizedException();

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

    // Hash both sides so timingSafeEqual gets equal-length buffers and the
    // comparison leaks nothing about token length or prefix.
    const presentedDigest = createHash("sha256").update(presented).digest();
    const expectedDigest = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(presentedDigest, expectedDigest)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
