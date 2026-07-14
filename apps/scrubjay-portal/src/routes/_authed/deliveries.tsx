import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchPendingAlerts, listDeliveries } from "@/server/functions/ops";

const searchSchema = z.object({
  alertId: z.string().optional(),
  channelId: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["sent", "failed", "expired", "suppressed"]).optional(),
});

const PAGE = 50;

const STATUS_VARIANT = {
  expired: "outline",
  failed: "destructive",
  sent: "default",
  suppressed: "secondary",
} as const;

export const Route = createFileRoute("/_authed/deliveries")({
  component: DeliveriesPage,
  loader: async ({ deps }: { deps: z.output<typeof searchSchema> }) => {
    const [deliveries, pending] = await Promise.all([
      listDeliveries({
        data: {
          alertId: deps.alertId || undefined,
          channelId: deps.channelId || undefined,
          limit: PAGE,
          offset: deps.offset,
          status: deps.status,
        },
      }),
      fetchPendingAlerts(),
    ]);
    return { deliveries, pending };
  },
  loaderDeps: ({ search }) => search,
  validateSearch: searchSchema,
});

function DeliveriesPage() {
  const { deliveries, pending } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Deliveries & pending alerts</h1>
      <Tabs defaultValue="deliveries">
        <TabsList>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="pending">
            Pending ({pending.alerts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent className="flex flex-col gap-4" value="deliveries">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const status = String(form.get("status") ?? "");
              void navigate({
                search: {
                  alertId: String(form.get("alertId") ?? "") || undefined,
                  channelId: String(form.get("channelId") ?? "") || undefined,
                  offset: 0,
                  status:
                    status === "any" || status === ""
                      ? undefined
                      : (status as never),
                },
              });
            }}
          >
            <Input
              className="w-48 font-mono"
              defaultValue={search.channelId ?? ""}
              name="channelId"
              placeholder="channel id"
            />
            <Input
              className="w-48 font-mono"
              defaultValue={search.alertId ?? ""}
              name="alertId"
              placeholder="alert id"
            />
            <Select defaultValue={search.status ?? "any"} name="status">
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">any status</SelectItem>
                <SelectItem value="sent">sent</SelectItem>
                <SelectItem value="failed">failed</SelectItem>
                <SelectItem value="expired">expired</SelectItem>
                <SelectItem value="suppressed">suppressed</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Sent at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[delivery.status]}>
                      {delivery.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {delivery.alertId}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {delivery.channelId}
                  </TableCell>
                  <TableCell>{delivery.kind}</TableCell>
                  <TableCell>{delivery.detail ?? "—"}</TableCell>
                  <TableCell>{delivery.sentAt ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-2">
            <Button
              disabled={search.offset === 0}
              onClick={() =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    offset: Math.max(0, search.offset - PAGE),
                  }),
                })
              }
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={!deliveries.hasMore}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, offset: search.offset + PAGE }),
                })
              }
              variant="outline"
            >
              Next
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="pending">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Species</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Observed</TableHead>
                <TableHead>Queued</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.alerts.map((alert) => (
                <TableRow
                  key={`${alert.channelId}/${alert.subId}/${alert.speciesCode}`}
                >
                  <TableCell>
                    {alert.comName}{" "}
                    <span className="text-neutral-500">
                      ({alert.speciesCode})
                    </span>
                  </TableCell>
                  <TableCell>
                    {alert.locationName} · {alert.county}, {alert.state}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {alert.channelId}
                  </TableCell>
                  <TableCell>{alert.obsDt}</TableCell>
                  <TableCell>{alert.createdAt}</TableCell>
                  <TableCell className="flex gap-1">
                    {alert.isPrivate ? (
                      <Badge variant="outline">private</Badge>
                    ) : null}
                    {alert.recentlyConfirmed ? (
                      <Badge variant="outline">confirmed</Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
