import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  type AddFilterBody,
  addFilterBodySchema,
  type ListFiltersResponse,
} from "@scrubjay/api-contracts";
import { FiltersRepository } from "@/features/filters/filters.repository";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller("api/v1/channels/:channelId/filters")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class FiltersController {
  constructor(private readonly repo: FiltersRepository) {}

  @Get()
  async list(
    @Param("channelId") channelId: string,
  ): Promise<ListFiltersResponse> {
    return { filters: await this.repo.channelFilters(channelId) };
  }

  @Post()
  async add(
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(addFilterBodySchema)) body: AddFilterBody,
  ): Promise<{ added: true }> {
    await this.repo.addChannelFilter(channelId, body.commonName);
    return { added: true };
  }

  @Delete()
  async remove(
    @Param("channelId") channelId: string,
    @Query(new ZodValidationPipe(addFilterBodySchema)) query: AddFilterBody,
  ): Promise<{ deleted: true }> {
    const existed = await this.repo.removeChannelFilter(
      channelId,
      query.commonName,
    );
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No such filter on that channel",
      });
    }
    return { deleted: true };
  }
}
