import { Module } from "@nestjs/common";
import { HealthCommands } from "./health.commands";

@Module({
  providers: [HealthCommands],
})
export class HealthModule {}
