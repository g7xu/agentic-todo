"use client";

import { ProjectTaskView } from "@/components/views/project-task-view";
import { useProjects } from "@/hooks/use-projects";

export default function InboxPage() {
  const { data: projects = [] } = useProjects();
  const inbox = projects.find((p) => p.isInbox);

  if (!inbox) {
    return (
      <div className="text-muted-foreground mx-auto max-w-2xl p-4 md:p-6">
        Loading…
      </div>
    );
  }
  return <ProjectTaskView projectId={inbox.id} title="Inbox" />;
}
