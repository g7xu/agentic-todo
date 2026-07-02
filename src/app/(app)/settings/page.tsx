"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useTimezone } from "@/components/timezone-context";
import { supportedTimeZones } from "@/lib/date";
import { updateTimezoneAction } from "@/app/actions/timezone";
import { TASKS_KEY } from "@/hooks/use-tasks";

export default function SettingsPage() {
  const current = useTimezone();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tz, setTz] = useState(current);
  const [saving, setSaving] = useState(false);
  const zones = supportedTimeZones();

  async function save() {
    setSaving(true);
    try {
      await updateTimezoneAction(tz);
      await queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      router.refresh(); // re-render the server layout so the tz context updates
      toast("Timezone updated");
    } catch {
      toast.error("Could not update timezone");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="grid max-w-sm gap-2">
        <Label htmlFor="tz">Timezone</Label>
        <Select value={tz} onValueChange={setTz}>
          <SelectTrigger id="tz">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map((z) => (
              <SelectItem key={z} value={z}>
                {z}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Used to compute “today” across Today, Upcoming, and the assistant.
        </p>
        <Button
          onClick={save}
          disabled={saving || tz === current}
          className="mt-2 w-fit"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
