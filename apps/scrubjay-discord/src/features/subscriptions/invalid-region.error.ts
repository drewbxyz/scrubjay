import { UserFacingError } from "@/discord/common/errors/user-facing.error";

export class InvalidRegionError extends UserFacingError {
  constructor(readonly regionCode: string) {
    super(`Invalid region code: ${regionCode}`);
    this.name = "InvalidRegionError";
  }
}
