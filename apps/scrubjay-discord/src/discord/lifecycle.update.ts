import { Injectable } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import { ActivityType, Events } from "discord.js";
import { Context, type ContextOf, On, Once } from "necord";

@Injectable()
export class LifecycleUpdate {
  private readonly reconnects = metrics
    .getMeter("scrubjay-discord")
    .createCounter("scrubjay.discord.gateway.reconnects", {
      description: "Discord gateway reconnect/resume events",
    });

  @Once(Events.ClientReady)
  async onClientReady(@Context() [client]: ContextOf<Events.ClientReady>) {
    client.user.setActivity("looking for birds...", {
      type: ActivityType.Custom,
    });
  }

  @On(Events.ShardReconnecting)
  onShardReconnecting() {
    this.reconnects.add(1, { event: "reconnecting" });
  }

  @On(Events.ShardResume)
  onShardResume() {
    this.reconnects.add(1, { event: "resume" });
  }
}
