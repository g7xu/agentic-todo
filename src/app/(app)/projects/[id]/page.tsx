"use client";

import { useParams } from "next/navigation";
import { ProjectTaskView } from "@/components/views/project-task-view";
import { useProjects } from "@/hooks/use-projects";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === id);

  return <ProjectTaskView projectId={id} title={project?.name ?? "Project"} />;
}
