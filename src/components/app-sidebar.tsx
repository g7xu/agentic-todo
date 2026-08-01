"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Hash,
  Inbox,
  MoreHorizontal,
  Plus,
  Repeat,
  Settings,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useRenameProject,
} from "@/hooks/use-projects";

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/upcoming", label: "Upcoming", icon: CalendarClock },
  // Replaced the Completed page (docs/ROUTINES.md §RV8). Completed ordinary
  // tasks remain reachable per project via each project view's "Show
  // completed" toggle.
  { href: "/activity", label: "Activity", icon: CheckCircle2 },
  { href: "/routines", label: "Routines", icon: Repeat },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { data: projects = [] } = useProjects();
  const createProject = useCreateProject();
  const renameProject = useRenameProject();
  const deleteProject = useDeleteProject();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const userProjects = projects.filter((p) => !p.isInbox);

  function submitNew() {
    const name = newName.trim();
    if (name) createProject.mutate(name);
    setNewName("");
    setAdding(false);
  }

  function submitRename(id: string) {
    const name = editName.trim();
    if (name) renameProject.mutate({ id, name });
    setEditingId(null);
  }

  return (
    <nav className="bg-muted/30 flex w-60 shrink-0 flex-col gap-1 border-r p-3 text-sm">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
              active ? "bg-accent font-medium" : "hover:bg-accent/60",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}

      <div className="mt-4 mb-1 flex items-center justify-between px-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Projects
        </span>
        <button
          aria-label="Add project"
          className="hover:bg-accent rounded p-1"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {adding && (
        <Input
          autoFocus
          value={newName}
          placeholder="Project name"
          className="mb-1 h-8"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNew();
            if (e.key === "Escape") {
              setAdding(false);
              setNewName("");
            }
          }}
          onBlur={submitNew}
        />
      )}

      {userProjects.map((p) => {
        const href = `/projects/${p.id}`;
        const active = pathname === href;
        if (editingId === p.id) {
          return (
            <Input
              key={p.id}
              autoFocus
              value={editName}
              className="mb-1 h-8"
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename(p.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              onBlur={() => submitRename(p.id)}
            />
          );
        }
        return (
          <div
            key={p.id}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1.5",
              active ? "bg-accent font-medium" : "hover:bg-accent/60",
            )}
          >
            <Link href={href} className="flex flex-1 items-center gap-2">
              <Hash className="size-4" />
              <span className="truncate">{p.name}</span>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`${p.name} options`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditingId(p.id);
                    setEditName(p.name);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => deleteProject.mutate(p.id)}
                >
                  <Trash2 className="size-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </nav>
  );
}
