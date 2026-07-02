export type TaskStatus = "active" | "completed";

/** Client-facing task shape. Dates are strings: `dueDate` is a calendar date
 * ('YYYY-MM-DD'), `completedAt`/`createdAt` are ISO timestamps. */
export type TaskDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  dueDate: string | null;
  status: TaskStatus;
  order: number;
  projectId: string;
  completedAt: string | null;
  createdAt: string;
};

export type ProjectDTO = {
  id: string;
  name: string;
  color: string | null;
  isInbox: boolean;
  order: number;
};
