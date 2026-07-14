import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AddSubscriptionForm } from "@/components/add-subscription-form";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addFilter,
  listFilters,
  removeFilter,
} from "@/server/functions/filters";
import { fetchGuilds } from "@/server/functions/guilds";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from "@/server/functions/subscriptions";

export const Route = createFileRoute("/_authed/channels/$channelId")({
  component: ChannelDetail,
  loader: async ({ params }) => {
    const [guilds, subscriptions, filters] = await Promise.all([
      fetchGuilds(),
      listSubscriptions({ data: { channelId: params.channelId } }),
      listFilters({ data: { channelId: params.channelId } }),
    ]);
    const channel = guilds.guilds
      .flatMap((guild) =>
        guild.channels.map((c) => ({ ...c, guildName: guild.name })),
      )
      .find((c) => c.id === params.channelId);
    return { channel, filters, subscriptions };
  },
});

function ChannelDetail() {
  const { channel, filters, subscriptions } = Route.useLoaderData();
  const { channelId } = Route.useParams();
  const router = useRouter();
  const [newFilter, setNewFilter] = useState("");

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
      await router.invalidate();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">
        {channel
          ? `#${channel.name} · ${channel.guildName}`
          : `Channel ${channelId}`}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>County</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.subscriptions.map((sub) => (
                <TableRow key={`${sub.stateCode}/${sub.countyCode}`}>
                  <TableCell className="font-mono">{sub.stateCode}</TableCell>
                  <TableCell className="font-mono">
                    {sub.countyCode === "*" ? "statewide" : sub.countyCode}
                  </TableCell>
                  <TableCell>
                    <Badge variant={sub.active ? "default" : "outline"}>
                      {sub.active ? "active" : "paused"}
                    </Badge>
                  </TableCell>
                  <TableCell>{sub.lastUpdated}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button
                      onClick={() =>
                        void run(
                          () =>
                            updateSubscription({
                              data: {
                                active: !sub.active,
                                channelId,
                                countyCode: sub.countyCode,
                                stateCode: sub.stateCode,
                              },
                            }),
                          sub.active
                            ? "Subscription paused"
                            : "Subscription resumed",
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {sub.active ? "Pause" : "Resume"}
                    </Button>
                    <ConfirmButton
                      confirmTitle={`Delete ${sub.stateCode}/${sub.countyCode}?`}
                      description="The channel will stop receiving alerts for this region."
                      label="Delete"
                      onConfirm={() =>
                        void run(
                          () =>
                            deleteSubscription({
                              data: {
                                channelId,
                                countyCode: sub.countyCode,
                                stateCode: sub.stateCode,
                              },
                            }),
                          "Subscription deleted",
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <AddSubscriptionForm
            onSubmit={(regionCode) =>
              run(
                () => createSubscription({ data: { channelId, regionCode } }),
                "Subscription created",
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Species filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {filters.filters.length === 0 ? (
            <p className="text-sm text-neutral-400">
              No filters for this channel.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filters.filters.map((filter) => (
                <li
                  className="flex items-center justify-between"
                  key={filter.commonName}
                >
                  <span>{filter.commonName}</span>
                  <ConfirmButton
                    confirmTitle={`Remove filter "${filter.commonName}"?`}
                    label="Remove"
                    onConfirm={() =>
                      void run(
                        () =>
                          removeFilter({
                            data: { channelId, commonName: filter.commonName },
                          }),
                        "Filter removed",
                      )
                    }
                    variant="outline"
                  />
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (newFilter.trim().length === 0) return;
              void run(
                () =>
                  addFilter({
                    data: { channelId, commonName: newFilter.trim() },
                  }),
                "Filter added",
              ).then(() => setNewFilter(""));
            }}
          >
            <Input
              className="w-64"
              onChange={(event) => setNewFilter(event.target.value)}
              placeholder="Common name, e.g. Rock Pigeon"
              value={newFilter}
            />
            <Button type="submit" variant="outline">
              Add filter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
