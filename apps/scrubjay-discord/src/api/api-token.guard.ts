import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
  // Ephemeral per-process key for the constant-time comparison below. Keyed
  // HMAC (not a plain hash) makes explicit that this equalizes buffer length
  // for timingSafeEqual — the token is a high-entropy shared secret compared
  // in memory, never a password stored at rest.
  private readonly compareKey = randomBytes(32);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get("SCRUBJAY_API_TOKEN", {
      infer: true,
    });
    if (!expected) throw new UnauthorizedException();

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

    // HMAC both sides with the ephemeral key so timingSafeEqual gets
    // equal-length buffers and the comparison leaks nothing about token
    // length or prefix.
    const presentedMac = createHmac("sha256", this.compareKey)
      .update(presented)
      .digest();
    const expectedMac = createHmac("sha256", this.compareKey)
      .update(expected)
      .digest();
    if (!timingSafeEqual(presentedMac, expectedMac)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
