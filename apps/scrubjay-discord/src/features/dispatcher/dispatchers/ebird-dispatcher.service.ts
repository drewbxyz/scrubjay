import { Injectable, Logger } from "@nestjs/common";
import { EmbedBuilder } from "discord.js";
import { DiscordHelper } from "@/discord/discord.helper";
import { DeliveriesService } from "../../deliveries/deliveries.service";
import { DispatcherRepository } from "../dispatcher.repository";
import type { DispatchableObservation } from "../dispatcher.schema";

@Injectable()
export class EBirdDispatcherService {
  private readonly logger = new Logger(EBirdDispatcherService.name);

  constructor(
    private readonly repo: DispatcherRepository,
    private readonly deliveries: DeliveriesService,
    private readonly discord: DiscordHelper,
  ) {}

  private generateSpeciesLocationId(speciesCode: string, locId: string) {
    return `${speciesCode}:${locId}`;
  }

  private groupObservations(ungroupedObservations: DispatchableObservation[]) {
    const channels = new Map<
      string,
      Map<string, Map<string, DispatchableObservation[]>>
    >();

    for (const obs of ungroupedObservations) {
      let speciesMap = channels.get(obs.channelId);

      if (!speciesMap) {
        speciesMap = new Map();
        channels.set(obs.channelId, speciesMap);
      }

      let locMap = speciesMap.get(obs.speciesCode);
      if (!locMap) {
        locMap = new Map();
        speciesMap.set(obs.speciesCode, locMap);
      }

      let list = locMap.get(obs.locId);
      if (!list) {
        list = [];
        locMap.set(obs.locId, list);
      }

      list.push(obs);
    }

    return channels;
  }

  private getAggregatedObservationStats(
    groupedObservations: DispatchableObservation[],
  ) {
    return groupedObservations.reduce(
      (acc, obs) => {
        acc.totalReports += 1;
        acc.totalPhotos += obs.photoCount ?? 0;
        acc.totalVideos += obs.videoCount ?? 0;
        acc.totalAudio += obs.audioCount ?? 0;
        acc.howMany = Math.max(acc.howMany, obs.howMany);
        acc.latestReport =
          !acc.latestReport || obs.obsDt > acc.latestReport
            ? obs.obsDt
            : acc.latestReport;
        return acc;
      },
      {
        howMany: 0,
        latestReport: groupedObservations[0]?.obsDt,
        totalAudio: 0,
        totalPhotos: 0,
        totalReports: 0,
        totalVideos: 0,
      },
    );
  }

  private async sendGroupedEBirdAlert(
    channelId: string,
    observations: DispatchableObservation[],
    confirmed: boolean,
  ) {
    if (observations.length === 0) return;

    const aggregatedStats = this.getAggregatedObservationStats(observations);

    const locationText = `Reported at ${
      observations[0].isPrivate
        ? "a private location"
        : `[${observations[0].locationName}](https://ebird.org/hotspot/${observations[0].locId})`
    }`;

    const embed = new EmbedBuilder()
      .setTitle(`${observations[0].comName} - ${observations[0].county}`)
      .setURL(`https://ebird.org/checklist/${observations[0].subId}`)
      .setDescription(
        `${locationText}\nLatest report: ${aggregatedStats.latestReport.toLocaleString(
          "en-US",
          {
            day: "numeric",
            hour: "numeric",
            hour12: true,
            minute: "2-digit",
            month: "numeric",
            year: "numeric",
          },
        )}`,
      )
      .setColor(confirmed ? 0x2ecc71 : 0xf1c40f);

    let reportText = `👥 ${aggregatedStats.totalReports} new report(s); ${
      confirmed
        ? "confirmed at location in the last week"
        : "unconfirmed at location in the last week"
    }`;

    const mediaTexts: string[] = [];
    if (aggregatedStats.totalPhotos > 0)
      mediaTexts.push(`📷 ${aggregatedStats.totalPhotos} photo(s)`);
    if (aggregatedStats.totalAudio > 0)
      mediaTexts.push(`🔊 ${aggregatedStats.totalAudio} audio`);
    if (aggregatedStats.totalVideos > 0)
      mediaTexts.push(`🎥 ${aggregatedStats.totalVideos} video(s)`);

    if (mediaTexts.length > 0) {
      reportText += `\n${mediaTexts.join(" • ")}`;
    }

    embed.addFields({ name: "Details", value: reportText });

    try {
      await this.discord.sendEmbedToChannel(channelId, embed);
    } catch (err) {
      this.logger.error(`Failed to send embed to channel: ${err}`);
    }
  }

  async getUndeliveredSinceDate(since?: Date) {
    return this.repo.getUndeliveredObservationsSinceDate(since);
  }

  async dispatchSince(since?: Date) {
    const sinceDate = since ?? new Date(Date.now() - 15 * 60 * 1000);
    const unsentObservations =
      await this.repo.getUndeliveredObservationsSinceDate(sinceDate);

    if (unsentObservations.length === 0) {
      this.logger.debug(`No new deliveries since ${sinceDate}`);
      return;
    }

    const confirmedInLastWeek = new Set(
      (
        await this.repo.getConfirmedSinceDate(
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // seven days ago
        )
      ).map((o) => this.generateSpeciesLocationId(o.speciesCode, o.locId)),
    );

    this.logger.debug(
      `Found ${unsentObservations.length} new channel-observation pairs`,
    );

    const grouped = this.groupObservations(unsentObservations);

    const deliveryValues: {
      alertKind: "ebird";
      alertId: string;
      channelId: string;
    }[] = [];

    for (const [channelId, speciesMap] of grouped) {
      for (const [species, locMap] of speciesMap) {
        for (const [location, obsList] of locMap) {
          const isConfirmedInLastWeek = confirmedInLastWeek.has(
            this.generateSpeciesLocationId(species, location),
          );

          await this.sendGroupedEBirdAlert(
            channelId,
            obsList,
            isConfirmedInLastWeek,
          );

          for (const obs of obsList) {
            deliveryValues.push({
              alertId: `${obs.speciesCode}:${obs.subId}`,
              alertKind: "ebird",
              channelId,
            });
          }
        }
      }
    }

    await this.deliveries.recordDeliveries(deliveryValues);

    this.logger.log(
      `Marked ${deliveryValues.length} / ${unsentObservations.length} as delivered (${Math.round((100 * deliveryValues.length) / unsentObservations.length)}%)`,
    );
  }
}
