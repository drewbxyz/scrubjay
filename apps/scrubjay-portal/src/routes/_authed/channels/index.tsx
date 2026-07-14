import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchGuilds } from "@/server/functions/guilds";
import { listSubscriptions } from "@/server/functions/subscriptions";

export const Route = createFileRoute("/_authed/channels/")({
  component: ChannelsPage,
  loader: async () => {
    const [guilds, subscriptions] = await Promise.all([
      fetchGuilds(),
      listSubscriptions({ data: {} }),
    ]);
    return { guilds, subscriptions };
  },
});

function ChannelsPage() {
  const { guilds, subscriptions } = Route.useLoaderData();
  const countByChannel = new Map<string, number>();
  for (const sub of subscriptions.subscriptions) {
    countByChannel.set(
      sub.channelId,
      (countByChannel.get(sub.channelId) ?? 0) + 1,
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Channels</h1>
      {guilds.guilds.map((guild) => (
        <Card key={guild.id}>
          <CardHeader>
            <CardTitle>{guild.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {guild.channels.map((channel) => (
              <Link
                className="flex items-center justify-between rounded px-3 py-2 hover:bg-neutral-900"
                key={channel.id}
                params={{ channelId: channel.id }}
                to="/channels/$channelId"
              >
                <span>#{channel.name}</span>
                <Badge variant="outline">
                  {countByChannel.get(channel.id) ?? 0} subscriptions
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
