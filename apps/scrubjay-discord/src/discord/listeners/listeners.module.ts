import { Module } from "@nestjs/common";
import { LifecycleListenerService } from "./lifecycle-listener.service";

@Module({
  providers: [LifecycleListenerService],
})
export class ListenersModule {}
