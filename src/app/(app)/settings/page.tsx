import { ConnectedApps } from "@/components/settings/connected-apps";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { YourData } from "@/components/settings/your-data";
import { requireUser } from "@/lib/auth/session";
import { resourceUrl } from "@/lib/oauth/config";
import { listGrants } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const apps = await listGrants(user.id);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="grid gap-2">
        <h2 className="text-lg font-medium">Timezone</h2>
        <TimezoneForm />
      </section>

      <section className="mt-10 grid gap-2">
        <h2 className="text-lg font-medium">Connected apps</h2>
        <ConnectedApps apps={apps} mcpUrl={resourceUrl()} />
      </section>

      <section className="mt-10 grid gap-2">
        <h2 className="text-lg font-medium">Your data</h2>
        <YourData />
      </section>
    </div>
  );
}
