import { Injectable, Logger } from "@nestjs/common";
import { EmbedBuilder } from "discord.js";
import { DiscordHelper } from "@/discord/discord.helper";
import {
  AlertQueue,
  type PendingEBirdAlert,
  type SentAlert,
} from "./alert-queue";

@Injectable()
export class EBirdDispatcherService {
  private readonly logger = new Logger(EBirdDispatcherService.name);

  constructor(
    private readonly alertQueue: AlertQueue,
    private readonly discord: DiscordHelper,
  ) {}

  private groupAlerts(alerts: PendingEBirdAlert[]) {
    const channels = new Map<
      string,
      Map<string, Map<string, PendingEBirdAlert[]>>
    >();

    for (const alert of alerts) {
      let speciesMap = channels.get(alert.channelId);
      if (!speciesMap) {
        speciesMap = new Map();
        channels.set(alert.channelId, speciesMap);
      }

      let locMap = speciesMap.get(alert.speciesCode);
      if (!locMap) {
        locMap = new Map();
        speciesMap.set(alert.speciesCode, locMap);
      }

      let list = locMap.get(alert.locId);
      if (!list) {
        list = [];
        locMap.set(alert.locId, list);
      }

      list.push(alert);
    }

    return channels;
  }

  private getAggregatedStats(alerts: PendingEBirdAlert[]) {
    return alerts.reduce(
      (acc, alert) => {
        acc.totalReports += 1;
        acc.totalPhotos += alert.photoCount;
        acc.totalVideos += alert.videoCount;
        acc.totalAudio += alert.audioCount;
        acc.howMany = Math.max(acc.howMany, alert.howMany);
        acc.latestReport =
          !acc.latestReport || alert.obsDt > acc.latestReport
            ? alert.obsDt
            : acc.latestReport;
        return acc;
      },
      {
        howMany: 0,
        latestReport: alerts[0]?.obsDt,
        totalAudio: 0,
        totalPhotos: 0,
        totalReports: 0,
        totalVideos: 0,
      },
    );
  }

  private async sendGroupedEBirdAlert(
    channelId: string,
    alerts: PendingEBirdAlert[],
  ) {
    if (alerts.length === 0) return;

    const stats = this.getAggregatedStats(alerts);
    const confirmed = alerts[0].recentlyConfirmed;

    const locationText = `Reported at ${
      alerts[0].isPrivate
        ? "a private location"
        : `[${alerts[0].locationName}](https://ebird.org/hotspot/${alerts[0].locId})`
    }`;

    const embed = new EmbedBuilder()
      .setTitle(`${alerts[0].comName} - ${alerts[0].county}`)
      .setURL(`https://ebird.org/checklist/${alerts[0].subId}`)
      .setDescription(
        `${locationText}\nLatest report: ${stats.latestReport.toLocaleString(
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

    let reportText = `👥 ${stats.totalReports} new report(s); ${
      confirmed
        ? "confirmed at location in the last week"
        : "unconfirmed at location in the last week"
    }`;

    const mediaTexts: string[] = [];
    if (stats.totalPhotos > 0)
      mediaTexts.push(`📷 ${stats.totalPhotos} photo(s)`);
    if (stats.totalAudio > 0) mediaTexts.push(`🔊 ${stats.totalAudio} audio`);
    if (stats.totalVideos > 0)
      mediaTexts.push(`🎥 ${stats.totalVideos} video(s)`);

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

  async dispatchSince(since?: Date) {
    const sinceDate = since ?? new Date(Date.now() - 15 * 60 * 1000);
    const pending = await this.alertQueue.pendingEBirdAlerts(sinceDate);

    if (pending.length === 0) {
      this.logger.debug(`No new alerts since ${sinceDate}`);
      return;
    }

    this.logger.debug(`Found ${pending.length} pending channel-alert pairs`);

    const sent: SentAlert[] = [];

    for (const [channelId, speciesMap] of this.groupAlerts(pending)) {
      for (const [, locMap] of speciesMap) {
        for (const [, alertList] of locMap) {
          await this.sendGroupedEBirdAlert(channelId, alertList);
          for (const alert of alertList) {
            sent.push({
              channelId,
              speciesCode: alert.speciesCode,
              subId: alert.subId,
            });
          }
        }
      }
    }

    await this.alertQueue.markSent(sent);

    this.logger.log(`Marked ${sent.length} alerts as delivered`);
  }
}
