import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
  type SubscriptionKey,
  subscriptionKeySchema,
  type UpdateSubscriptionBody,
  updateSubscriptionBodySchema,
} from "@scrubjay/api-contracts";
import { InvalidRegionError } from "@/features/subscriptions/invalid-region.error";
import { SubscriptionsRepository } from "@/features/subscriptions/subscriptions.repository";
import { SubscriptionsService } from "@/features/subscriptions/subscriptions.service";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { ZodValidationPipe } from "./zod-validation.pipe";

/** SubscriptionsService takes one region code; the key stores it split. */
function regionCodeOf(key: SubscriptionKey): string {
  return key.countyCode === "*" ? key.stateCode : key.countyCode;
}

@Controller("api/v1/subscriptions")
@UseFilters(ApiExceptionFilter)
@UseGuards(ApiTokenGuard)
export class SubscriptionsController {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly service: SubscriptionsService,
  ) {}

  @Get()
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

  @Post()
  async create(
    @Body(new ZodValidationPipe(createSubscriptionBodySchema))
    body: CreateSubscriptionBody,
  ): Promise<CreateSubscriptionResponse> {
    try {
      const created = await this.service.subscribe(
        body.channelId,
        body.regionCode,
      );
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

  @Patch()
  async update(
    @Body(new ZodValidationPipe(updateSubscriptionBodySchema))
    body: UpdateSubscriptionBody,
  ): Promise<{ updated: true }> {
    const { active, ...key } = body;
    const existed = await this.repo.setSubscriptionActive(key, active);
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No subscription at that key",
      });
    }
    return { updated: true };
  }

  @Delete()
  async remove(
    @Query(new ZodValidationPipe(subscriptionKeySchema)) key: SubscriptionKey,
  ): Promise<{ deleted: true }> {
    const existed = await this.service.unsubscribe(
      key.channelId,
      regionCodeOf(key),
    );
    if (!existed) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No subscription at that key",
      });
    }
    return { deleted: true };
  }
}
