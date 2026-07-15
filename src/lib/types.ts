/** 'missed' = a routine instance swept at day rollover; reversible via the
 * normal complete path (backfill). Views only match 'active'/'completed', so
 * missed rows stay out of every list except the Today recap strip. */
export type TaskStatus = "active" | "completed" | "missed";

/** Client-facing task shape. Dates are strings: `dueDate` is a calendar date
 * ('YYYY-MM-DD'), `completedAt`/`createdAt` are ISO timestamps. */
export type TaskDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  dueDate: string | null;
  timeUsed: number | null; // minutes spent on the task ("HH:MM" in the UI)
  status: TaskStatus;
  order: number;
  projectId: string;
  routineId: string | null; // set when this task is a materialized routine instance
  completedAt: string | null;
  createdAt: string;
};

export type RoutineOnMiss = "skip" | "carry";

/** Client-facing routine (daily-recurring task template) shape. */
export type RoutineDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  projectId: string;
  schedule: string; // v1: literal 'daily'
  onMiss: RoutineOnMiss;
  active: boolean;
  createdAt: string;
};

export type ProjectDTO = {
  id: string;
  name: string;
  color: string | null;
  isInbox: boolean;
  order: number;
};
