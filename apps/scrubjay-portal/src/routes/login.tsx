import { createFileRoute } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">ScrubJay Portal</h1>
      <p className="text-neutral-400">Operator sign-in required.</p>
      <button
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500"
        onClick={() =>
          authClient.signIn.social({ callbackURL: "/", provider: "discord" })
        }
        type="button"
      >
        Sign in with Discord
      </button>
    </main>
  );
}
