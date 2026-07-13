import { Controller, Get, Param, UseFilters, UseGuards } from "@nestjs/common";
import {
  type CountiesResponse,
  stateCodeSchema,
} from "@scrubjay/api-contracts";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { EBirdRegionsService } from "./ebird-regions.service";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller("api/v1/ebird/regions")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class EBirdRegionsController {
  constructor(private readonly ebird: EBirdRegionsService) {}

  @Get(":stateCode/counties")
  counties(
    @Param("stateCode", new ZodValidationPipe(stateCodeSchema))
    stateCode: string,
  ): Promise<CountiesResponse> {
    return this.ebird.countiesForState(stateCode);
  }
}
