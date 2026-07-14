import type { GuildsResponse } from "@scrubjay/api-contracts";
import { guildsResponseSchema } from "@scrubjay/api-contracts";
import { createServerFn } from "@tanstack/react-start";
import { botApi } from "@/server/bot-api";
import { requireOperator } from "@/server/operators";

export function fetchGuildsImpl(): Promise<GuildsResponse> {
  return botApi(guildsResponseSchema, {
    endpoint: "guilds.list",
    path: "/api/v1/guilds",
  });
}

export const fetchGuilds = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireOperator();
    return fetchGuildsImpl();
  },
);
