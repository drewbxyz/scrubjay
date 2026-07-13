import { Module } from "@nestjs/common";
import { FiltersReactions } from "./filters.reactions";
import { FiltersRepository } from "./filters.repository";

@Module({
  exports: [FiltersRepository],
  providers: [FiltersReactions, FiltersRepository],
})
export class FiltersModule {}
