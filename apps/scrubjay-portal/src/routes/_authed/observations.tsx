import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listObservations } from "@/server/functions/ops";

const searchSchema = z.object({
  countyCode: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  speciesCode: z.string().optional(),
  stateCode: z.string().optional(),
});

const PAGE = 50;

export const Route = createFileRoute("/_authed/observations")({
  component: ObservationsPage,
  loader: ({ deps }: { deps: z.output<typeof searchSchema> }) =>
    listObservations({
      data: {
        countyCode: deps.countyCode || undefined,
        limit: PAGE,
        offset: deps.offset,
        speciesCode: deps.speciesCode || undefined,
        stateCode: deps.stateCode || undefined,
      },
    }),
  loaderDeps: ({ search }) => search,
  validateSearch: searchSchema,
});

function ObservationsPage() {
  const data = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Observations</h1>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void navigate({
            search: {
              countyCode: String(form.get("countyCode") ?? "") || undefined,
              offset: 0,
              speciesCode: String(form.get("speciesCode") ?? "") || undefined,
              stateCode: String(form.get("stateCode") ?? "") || undefined,
            },
          });
        }}
      >
        <Input
          className="w-28 font-mono"
          defaultValue={search.stateCode ?? ""}
          name="stateCode"
          placeholder="US-CA"
        />
        <Input
          className="w-36 font-mono"
          defaultValue={search.countyCode ?? ""}
          name="countyCode"
          placeholder="US-CA-085"
        />
        <Input
          className="w-36 font-mono"
          defaultValue={search.speciesCode ?? ""}
          name="speciesCode"
          placeholder="species code"
        />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Species</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>Observed</TableHead>
            <TableHead>Ingested</TableHead>
            <TableHead>Media</TableHead>
            <TableHead>Checklist</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.observations.map((obs) => (
            <TableRow key={`${obs.subId}/${obs.speciesCode}`}>
              <TableCell>
                {obs.comName}{" "}
                <span className="text-neutral-500">({obs.speciesCode})</span>
              </TableCell>
              <TableCell>
                {obs.locationName} · {obs.county}, {obs.state}
              </TableCell>
              <TableCell>{obs.obsDt}</TableCell>
              <TableCell>{obs.createdAt}</TableCell>
              <TableCell>
                📷{obs.photoCount} 🔊{obs.audioCount} 🎬{obs.videoCount}
              </TableCell>
              <TableCell className="font-mono text-xs">{obs.subId}</TableCell>
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
          disabled={!data.hasMore}
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
    </div>
  );
}
