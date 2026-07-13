import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  type CreateSubscriptionBody,
  type CreateSubscriptionResponse,
  createSubscriptionBodySchema,
  type ListSubscriptionsQuery,
  listSubscriptionsQuerySchema,
  type SubscriptionRegionKey,
  subscriptionRegionKeySchema,
  type UpdateSubscriptionBody,
  updateSubscriptionBodySchema,
} from "@scrubjay/api-contracts";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import { API_PREFIX } from "./api.constants";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { GuildsService } from "./guilds.service";
import { ZodValidationPipe } from "./zod-validation.pipe";

/** SubscriptionsService takes one region code; the key stores it split. */
function regionCodeOf(key: SubscriptionRegionKey): string {
  return key.countyCode === "*" ? key.stateCode : key.countyCode;
}

@Controller(API_PREFIX)
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class SubscriptionsController {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly service: SubscriptionsService,
    private readonly guilds: GuildsService,
  ) {}

  @Get("subscriptions")
  async list(
    @Query(new ZodValidationPipe(listSubscriptionsQuerySchema))
    query: ListSubscriptionsQuery,
  ): Promise<{
    subscriptions: Awaited<
      ReturnType<SubscriptionsRepository["listSubscriptions"]>
    >;
  }> {
    return { subscriptions: await this.repo.listSubscriptions(query) };
  }

  // Idempotent "ensure": 200 with an honest `created` flag, not a POST 201.
  @Post("channels/:channelId/subscriptions")
  @HttpCode(HttpStatus.OK)
  async create(
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(createSubscriptionBodySchema))
    body: CreateSubscriptionBody,
  ): Promise<CreateSubscriptionResponse> {
    // Unlike the slash-command path, the API can't structurally guarantee a
    // real postable channel — a typo'd id would start ingest for a new state.
    if (!(await this.guilds.isPostableChannel(channelId))) {
      throw new BadRequestException({
        code: "INVALID_CHANNEL",
        message: "Channel not found or the bot cannot post to it",
      });
    }
    try {
      const created = await this.service.subscribe(channelId, body.regionCode);
      return { created };
    } catch (err) {
      if (err instanceof InvalidRegionError) {
        throw new BadRequestException({
          code: "INVALID_REGION",
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Patch("channels/:channelId/subscriptions")
  async update(
    @Param("channelId") channelId: string,
    @Body(new ZodValidationPipe(updateSubscriptionBodySchema))
    body: UpdateSubscriptionBody,
  ): Promise<{
    subscription: NonNullable<
      Awaited<ReturnType<SubscriptionsRepository["setSubscriptionActive"]>>
    >;
  }> {
    const { active, ...region } = body;
    const subscription = await this.repo.setSubscriptionActive(
      { channelId, ...region },
      active,
    );
    if (!subscription) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No subscription at that key",
      });
    }
    return { subscription };
  }

  @Delete("channels/:channelId/subscriptions")
  async remove(
    @Param("channelId") channelId: string,
    @Query(new ZodValidationPipe(subscriptionRegionKeySchema))
    region: SubscriptionRegionKey,
  ): Promise<{ deleted: true }> {
    let existed: boolean;
    try {
      existed = await this.service.unsubscribe(channelId, regionCodeOf(region));
    } catch (err) {
      if (err instanceof InvalidRegionError) {
        throw new BadRequestException({
          code: "INVALID_REGION",
          message: err.message,
        });
      }
      throw err;
    }
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No subscription at that key",
      });
    }
    return { deleted: true };
  }
}
