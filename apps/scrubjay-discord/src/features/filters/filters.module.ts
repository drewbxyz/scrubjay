import { Module } from "@nestjs/common";
import { FiltersReactions } from "./filters.reactions";
import { FiltersRepository } from "./filters.repository";

@Module({
  providers: [FiltersReactions, FiltersRepository],
})
export class FiltersModule {}
