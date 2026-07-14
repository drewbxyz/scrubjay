import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <main className="p-8">ScrubJay Portal — scaffold OK</main>,
});
