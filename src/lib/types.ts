/** 'missed' = a parked routine instance (paused routine's leftover or a
 * rare carry collision). Views only match 'active'/'completed', so these
 * rows never appear in any list. */
export type TaskStatus = "active" | "completed" | "missed";

/** Client-facing task shape. Dates are strings: `dueDate` is a calendar date
 * ('YYYY-MM-DD'), `completedAt`/`createdAt` are ISO timestamps. */
export type TaskDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  dueDate: string | null;
  estimate: number | null; // expected minutes (docs/ESTIMATES.md)
  timeUsed: number | null; // minutes actually spent
  status: TaskStatus;
  order: number;
  projectId: string;
  routineId: string | null; // set when this task is a materialized routine instance
  completedAt: string | null;
  createdAt: string;
};

export type RoutineRepeatBase = "scheduled" | "completed";

export type RoutineRepeatUnit = "day" | "week" | "weekday" | "month" | "year";

/** Client-facing routine (recurring task template) shape. An unfinished
 * instance always carries forward to the next day, whatever the cadence. */
export type RoutineDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  estimate: number | null; // default expected minutes, copied into each instance
  projectId: string;
  repeatEvery: number; // every N units
  repeatUnit: RoutineRepeatUnit;
  repeatWeekdays: number[]; // 0=Sun … 6=Sat; 'week' unit only, else empty
  repeatBase: RoutineRepeatBase;
  startDate: string; // 'YYYY-MM-DD' grid anchor (user-local creation day)
  endDate: string | null; // last day new instances spawn (inclusive)
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
