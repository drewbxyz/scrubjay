import { EmbedBuilder, type MessageCreateOptions } from "discord.js";
import type { PendingEBirdAlert } from "./alert-queue.service";

export type DispatchPlan = {
  alerts: PendingEBirdAlert[];
  channelId: string;
  message: MessageCreateOptions;
};

/**
 * Pure planning step of the Dispatch pipeline: one embed per
 * channel × species × location group. Never touches the AlertQueue —
 * DispatchService owns the send-then-record protocol.
 */
export function planEBirdAlerts(pending: PendingEBirdAlert[]): DispatchPlan[] {
  const groups = new Map<string, PendingEBirdAlert[]>();
  for (const alert of pending) {
    const key = `${alert.channelId}:${alert.speciesCode}:${alert.locId}`;
    const group = groups.get(key);
    if (group) {
      group.push(alert);
    } else {
      groups.set(key, [alert]);
    }
  }

  return Array.from(groups.values(), (alerts) => ({
    alerts,
    channelId: alerts[0].channelId,
    message: { embeds: [buildEBirdAlertEmbed(alerts)] },
  }));
}

function aggregateStats(alerts: PendingEBirdAlert[]) {
  return alerts.reduce(
    (acc, alert) => {
      acc.totalReports += 1;
      acc.totalPhotos += alert.photoCount;
      acc.totalVideos += alert.videoCount;
      acc.totalAudio += alert.audioCount;
      acc.latestReport =
        alert.obsDt > acc.latestReport ? alert.obsDt : acc.latestReport;
      return acc;
    },
    {
      latestReport: alerts[0].obsDt,
      totalAudio: 0,
      totalPhotos: 0,
      totalReports: 0,
      totalVideos: 0,
    },
  );
}

function buildEBirdAlertEmbed(alerts: PendingEBirdAlert[]): EmbedBuilder {
  const stats = aggregateStats(alerts);
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

  return embed;
}
