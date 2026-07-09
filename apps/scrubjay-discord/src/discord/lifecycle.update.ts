import { Injectable } from "@nestjs/common";
import { ActivityType, Events } from "discord.js";
import { Context, type ContextOf, Once } from "necord";

@Injectable()
export class LifecycleUpdate {
  @Once(Events.ClientReady)
  async onClientReady(@Context() [client]: ContextOf<Events.ClientReady>) {
    client.user.setActivity("looking for birds...", {
      type: ActivityType.Custom,
    });
  }
}
