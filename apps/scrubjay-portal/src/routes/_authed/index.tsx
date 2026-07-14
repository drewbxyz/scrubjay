import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/")({
  component: () => <h1 className="text-xl font-semibold">Dashboard</h1>,
});
