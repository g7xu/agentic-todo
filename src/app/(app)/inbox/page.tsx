"use client";

import { ProjectTaskView } from "@/components/views/project-task-view";
import { useProjects } from "@/hooks/use-projects";

export default function InboxPage() {
  const { data: projects = [] } = useProjects();
  const inbox = projects.find((p) => p.isInbox);

  if (!inbox) {
    return <div className="mx-auto max-w-2xl p-6 text-muted-foreground">Loading…</div>;
  }
  return <ProjectTaskView projectId={inbox.id} title="Inbox" />;
}
