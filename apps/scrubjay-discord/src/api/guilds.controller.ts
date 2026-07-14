import { Controller, Get, UseFilters, UseGuards } from "@nestjs/common";
import type { GuildsResponse } from "@scrubjay/api-contracts";
import { API_PREFIX } from "./api.constants";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { GuildsService } from "./guilds.service";

@Controller(`${API_PREFIX}/guilds`)
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class GuildsController {
  constructor(private readonly guilds: GuildsService) {}

  @Get()
  list(): Promise<GuildsResponse> {
    return this.guilds.listGuilds();
  }
}
