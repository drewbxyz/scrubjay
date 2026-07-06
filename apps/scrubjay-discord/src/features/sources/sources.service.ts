import { Injectable, Logger } from "@nestjs/common";
import { SourcesRepository } from "./sources.repository";

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(private readonly repo: SourcesRepository) {}

  /**
   * Returns a list of state codes that channels are currently subscribed to.
   */
  async getEBirdSources() {
    try {
      return this.repo.getEBirdSources();
    } catch (err) {
      this.logger.error(`Error fetching eBird sources: ${err}`);
      return [];
    }
  }
}
