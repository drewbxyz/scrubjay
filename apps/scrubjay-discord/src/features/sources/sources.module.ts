import { Module } from "@nestjs/common";
import { SourcesRepository } from "./sources.repository";

@Module({
  exports: [SourcesRepository],
  imports: [],
  providers: [SourcesRepository],
})
export class SourcesModule {}
