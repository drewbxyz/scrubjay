import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Events } from "discord.js";
import { Context, type ContextOf, On } from "necord";
import type { AppConfig } from "@/core/config/config.schema";
import { FiltersRepository } from "./filters.repository";

@Injectable()
export class FiltersReactions {
  private readonly logger = new Logger(FiltersReactions.name);

  constructor(
    private readonly repo: FiltersRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @On(Events.MessageReactionAdd)
  async onReactionAdd(
    @Context() [reaction, user]: ContextOf<Events.MessageReactionAdd>,
  ) {
    if (user.partial) {
      try {
        user = await user.fetch();
      } catch (error) {
        this.logger.error(
          `Error fetching user`,
          error instanceof Error ? error.stack : String(error),
        );
        return;
      }
    }

    if (user.bot) return; // ignore any bot

    if (reaction.partial) {
      try {
        reaction = await reaction.fetch();
      } catch (error) {
        this.logger.error(
          `Error fetching reaction`,
          error instanceof Error ? error.stack : String(error),
        );
        return;
      }
    }

    if (reaction.emoji.name !== "👎") return;

    const threshold = this.config.get("FILTER_REACTION_THRESHOLD", {
      infer: true,
    });
    if (reaction.count < threshold) {
      this.logger.debug("Filter vote added, but count is below threshold");
      return;
    }

    const message = reaction.message;

    try {
      const filterable = await this.repo.isChannelFilterable(message.channelId);
      if (!filterable) return;

      const embed = message.embeds[0];
      if (!embed || !embed.title) return;

      const speciesCommonName = this.extractSpeciesNameFromTitle(embed.title);
      if (!speciesCommonName) return;

      await this.repo.addChannelFilter(message.channelId, speciesCommonName);

      this.logger.log(
        `Filter added: ${speciesCommonName} - ${message.channelId}`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to process filter reaction: ${err.message}`,
        err.stack,
      );
      return;
    }
  }

  private extractSpeciesNameFromTitle(title: string) {
    const idx = title.lastIndexOf(" - ");
    return idx === -1 ? title : title.slice(0, idx);
  }
}
