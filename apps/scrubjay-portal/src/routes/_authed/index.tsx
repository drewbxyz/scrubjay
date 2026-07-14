import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchBotHealth,
  fetchPendingAlerts,
  fetchRegions,
  listDeliveries,
} from "@/server/functions/ops";

export const Route = createFileRoute("/_authed/")({
  component: Dashboard,
  loader: async () => {
    const [health, regions, pending, failures] = await Promise.all([
      fetchBotHealth(),
      fetchRegions(),
      fetchPendingAlerts(),
      listDeliveries({ data: { limit: 10, offset: 0, status: "failed" } }),
    ]);
    return { failures, health, pending, regions };
  },
});

function Dashboard() {
  const { failures, health, pending, regions } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Bot health</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.ok ? "default" : "destructive"}>
              {health.status}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending alerts</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {pending.alerts.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ingest regions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {regions.regions.map((region) => (
              <Badge key={region.stateCode} variant="outline">
                {region.stateCode} · {region.subscriptions.length}
              </Badge>
            ))}
            {regions.regions.length === 0 ? (
              <span className="text-sm text-neutral-400">
                No subscriptions yet
              </span>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent delivery failures</CardTitle>
        </CardHeader>
        <CardContent>
          {failures.deliveries.length === 0 ? (
            <p className="text-sm text-neutral-400">No recent failures.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Sent at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
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
          )}
          <Link
            className="mt-2 inline-block text-sm text-indigo-400"
            to="/deliveries"
          >
            All deliveries →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
