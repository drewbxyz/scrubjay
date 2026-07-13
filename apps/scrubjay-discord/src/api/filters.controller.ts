import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  type AddFilterBody,
  type AddFilterResponse,
  addFilterBodySchema,
  channelIdSchema,
  type DeleteFilterQuery,
  deleteFilterQuerySchema,
  type ListFiltersResponse,
} from "@scrubjay/api-contracts";
import { FiltersRepository } from "@/features/filters/filters.repository";
import { API_PREFIX } from "./api.constants";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller(`${API_PREFIX}/channels/:channelId/filters`)
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class FiltersController {
  constructor(private readonly repo: FiltersRepository) {}

  @Get()
  async list(
    @Param("channelId", new ZodValidationPipe(channelIdSchema))
    channelId: string,
  ): Promise<ListFiltersResponse> {
    return { filters: await this.repo.channelFilters(channelId) };
  }

  // Idempotent "ensure": 200 with an honest `added` flag, not a POST 201.
  // `onConflictDoNothing().returning()` yields [] when the filter already
  // existed, so an empty result means nothing was inserted.
  @Post()
  @HttpCode(HttpStatus.OK)
  async add(
    @Param("channelId", new ZodValidationPipe(channelIdSchema))
    channelId: string,
    @Body(new ZodValidationPipe(addFilterBodySchema)) body: AddFilterBody,
  ): Promise<AddFilterResponse> {
    const rows = await this.repo.addChannelFilter(channelId, body.commonName);
    return { added: rows.length > 0 };
  }

  @Delete()
  async remove(
    @Param("channelId", new ZodValidationPipe(channelIdSchema))
    channelId: string,
    @Query(new ZodValidationPipe(deleteFilterQuerySchema))
    query: DeleteFilterQuery,
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
