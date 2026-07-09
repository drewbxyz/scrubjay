import { Module } from "@nestjs/common";
import { LifecycleUpdate } from "./lifecycle.update";
import { MessageSenderService } from "./message-sender.service";

@Module({
  exports: [MessageSenderService],
  providers: [MessageSenderService, LifecycleUpdate],
})
export class DiscordModule {}
