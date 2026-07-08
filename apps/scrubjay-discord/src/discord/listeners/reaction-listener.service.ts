import { Injectable, Logger } from "@nestjs/common";
import { Events } from "discord.js";
import { Context, type ContextOf, On } from "necord";
import { ReactionRouter } from "../reaction-router/reaction-router.service";

@Injectable()
export class ReactionListenerService {
  private readonly logger = new Logger(ReactionListenerService.name);
  constructor(private readonly reactionRouter: ReactionRouter) {}

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

    try {
      await this.reactionRouter.route({
        reaction,
        user,
      });
    } catch (err) {
      this.logger.error(`Could not route reaction: ${err}`);
    }
  }
}
