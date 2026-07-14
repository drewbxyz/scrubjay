import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { getSessionUser } from "@/server/functions/session";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const user = await getSessionUser();
    if (user.status === "anonymous") throw redirect({ to: "/login" });
    if (user.status === "forbidden") throw redirect({ to: "/forbidden" });
    return { user };
  },
  component: AuthedLayout,
});

const NAV = [
  { label: "Dashboard", to: "/" },
  { label: "Channels", to: "/channels" },
  { label: "Observations", to: "/observations" },
  { label: "Deliveries", to: "/deliveries" },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-neutral-800 p-4">
        <span className="mb-6 text-lg font-semibold">ScrubJay</span>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-neutral-800 text-white" }}
              className="rounded px-3 py-2 text-neutral-300 hover:bg-neutral-900"
              key={item.to}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 text-sm text-neutral-400">
          <span>{user.name}</span>
          <button
            className="rounded border border-neutral-700 px-2 py-1 text-left hover:bg-neutral-800"
            onClick={() =>
              void authClient
                .signOut()
                .then(() => router.invalidate())
                .then(() => navigate({ to: "/login" }))
            }
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
