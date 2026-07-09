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
        this.logger.error(`Error fetching user: ${error}`);
        return;
      }
    }

    if (user.bot) return; // ignore any bot

    if (reaction.partial) {
      try {
        reaction = await reaction.fetch();
      } catch (error) {
        this.logger.error(`Error fetching reaction: ${error}`);
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

    const filterable = await this.repo.isChannelFilterable(message.channelId);
    if (!filterable) return;

    const embed = message.embeds[0];
    if (!embed || !embed.title) return;

    const speciesCommonName = this.extractSpeciesNameFromTitle(embed.title);
    if (!speciesCommonName) return;

    try {
      await this.repo.addChannelFilter(message.channelId, speciesCommonName);
    } catch (err) {
      this.logger.error(
        `Could not insert filter into database (${message.channelId}:${speciesCommonName}): ${err}`,
      );
      return;
    }

    this.logger.log(
      `Filter added: ${speciesCommonName} - ${message.channelId}`,
    );
  }

  private extractSpeciesNameFromTitle(title: string) {
    const idx = title.lastIndexOf(" - ");
    return idx === -1 ? title : title.slice(0, idx);
  }
}
