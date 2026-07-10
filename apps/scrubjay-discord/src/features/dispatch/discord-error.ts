import { DiscordAPIError } from "discord.js";

/**
 * Classification of a failed Discord send (spec §2). Permanent errors get a
 * 'failed' delivery row and are never retried; `channelGone` additionally
 * deactivates the channel's subscriptions. Everything else is transient:
 * no row is written, so the alert stays pending and retries next tick.
 * discord.js queues/retries 429s internally, so they never surface here.
 */
export type SendFailure =
  | { kind: "permanent"; code: number; channelGone: boolean }
  | { kind: "transient" };

const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

export function classifySendError(err: unknown): SendFailure {
  if (!(err instanceof DiscordAPIError) || typeof err.code !== "number") {
    return { kind: "transient" };
  }
  if (err.code === UNKNOWN_CHANNEL) {
    return { channelGone: true, code: err.code, kind: "permanent" };
  }
  if (err.code === MISSING_ACCESS || err.code === MISSING_PERMISSIONS) {
    return { channelGone: false, code: err.code, kind: "permanent" };
  }
  return { kind: "transient" };
}
