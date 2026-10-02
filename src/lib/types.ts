/** 'missed' = a routine day that passed without being done. Views only match
 * 'active'/'completed', so these rows never appear in any list; they are read
 * by the Activity grid alone. */
export type TaskStatus = "active" | "completed" | "missed";

/** Client-facing task shape. Dates are strings: `dueDate`/`deadline` are
 * calendar dates ('YYYY-MM-DD'), `completedAt`/`createdAt` are ISO timestamps. */
export type TaskDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  dueDate: string | null; // PLANNED date — when the user intends to do it
  deadline: string | null; // hard deadline (docs/DEADLINES.md); never moved by drag/reschedule
  estimate: number | null; // expected minutes (docs/ESTIMATES.md)
  timeUsed: number | null; // minutes actually spent
  status: TaskStatus;
  order: number;
  projectId: string;
  routineId: string | null; // set when this row records a routine day's outcome
  completedAt: string | null;
  createdAt: string;
};

export type RoutineRepeatBase = "scheduled" | "completed";

export type RoutineRepeatUnit = "day" | "week" | "weekday" | "month" | "year";

/** Client-facing routine (recurring task template) shape. Its occurrences are
 * computed from the cadence; a day left undone is recorded as missed and does
 * not move to the next day. */
export type RoutineDTO = {
  id: string;
  content: string;
  description: string | null;
  priority: number; // 1=p1 (highest) … 4=default
  estimate: number | null; // default expected minutes, copied into each recorded day
  projectId: string;
  repeatEvery: number; // every N units
  repeatUnit: RoutineRepeatUnit;
  repeatWeekdays: number[]; // 0=Sun … 6=Sat; 'week' unit only, else empty
  repeatBase: RoutineRepeatBase;
  startDate: string; // 'YYYY-MM-DD' grid anchor (user-local creation day)
  endDate: string | null; // last day the routine is due (inclusive)
  active: boolean;
  /** User-local day of the newest completion. Set for completed-based
   * routines only, which are the ones whose next due day depends on it. */
  lastCompletedOn: string | null;
  createdAt: string;
};

export type ProjectDTO = {
  id: string;
  name: string;
  color: string | null;
  isInbox: boolean;
  order: number;
};
