import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/forbidden")({
  component: ForbiddenPage,
});

function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">403 — not an operator</h1>
      <p className="max-w-md text-center text-neutral-400">
        You signed in successfully, but this Discord account is not on the
        operator allowlist for this ScrubJay deployment.
      </p>
      <button
        className="rounded-md border border-neutral-700 px-4 py-2 hover:bg-neutral-800"
        onClick={() =>
          void authClient.signOut().then(() => navigate({ to: "/login" }))
        }
        type="button"
      >
        Sign out
      </button>
    </main>
  );
}
