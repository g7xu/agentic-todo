import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addDays, dateStrInTz, dbDateToStr, toDbDate } from "@/lib/date";
import { getInboxId } from "@/lib/data/projects";
import { TASK_SELECT, taskToDTO } from "@/lib/data/tasks";
import { isUniqueViolation } from "@/lib/provisioning";
import { MAX_CARRIED, NOTE_KINDS } from "@/lib/reviews";
import type {
  NoteKind,
  ReviewDTO,
  ReviewNoteDTO,
  ReviewSummaryDTO,
  TaskDTO,
} from "@/lib/types";

/**
 * Weekly reviews (docs/REVIEWS.md). A week is keyed by its Sunday as
 * 'YYYY-MM-DD'; callers validate that before reaching this module.
 */

export const REVIEW_CLOSED = "Review is closed";

const NOTE_SELECT = {
  id: true,
  kind: true,
  content: true,
  order: true,
  carriedTaskId: true,
  createdAt: true,
} as const;

type NoteRow = {
  id: string;
  kind: string;
  content: string;
  order: number;
  carriedTaskId: string | null;
  createdAt: Date;
};

type ReviewRow = {
  id: string;
  weekStart: Date;
  closedAt: Date | null;
  notes: NoteRow[];
};

const REVIEW_SELECT = {
  id: true,
  weekStart: true,
  closedAt: true,
  notes: {
    select: NOTE_SELECT,
    orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ReviewSelect;

function noteToDTO(n: NoteRow): ReviewNoteDTO {
  return {
    id: n.id,
    kind: n.kind as NoteKind,
    content: n.content,
    order: n.order,
    carriedTaskId: n.carriedTaskId,
    createdAt: n.createdAt.toISOString(),
  };
}

function reviewToDTO(r: ReviewRow): ReviewDTO {
  return {
    id: r.id,
    weekStart: dbDateToStr(r.weekStart)!,
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    notes: r.notes.map(noteToDTO),
  };
}

function weekKey(userId: string, week: string) {
  return { userId_weekStart: { userId, weekStart: toDbDate(week) } };
}

/** Every week that has a review, newest first, with note counts per column. */
export async function listReviews(userId: string): Promise<ReviewSummaryDTO[]> {
  const rows = await prisma.review.findMany({
    where: { userId },
    orderBy: { weekStart: "desc" },
    select: { weekStart: true, closedAt: true, notes: { select: { kind: true } } },
  });
  return rows.map((r) => {
    const counts = Object.fromEntries(NOTE_KINDS.map((k) => [k, 0])) as Record<
      NoteKind,
      number
    >;
    for (const n of r.notes) counts[n.kind as NoteKind] += 1;
    return {
      weekStart: dbDateToStr(r.weekStart)!,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      counts,
    };
  });
}

/** The week's review, or null when nothing was ever written for it. */
export async function getReview(
  userId: string,
  week: string,
): Promise<ReviewDTO | null> {
  const r = await prisma.review.findUnique({
    where: weekKey(userId, week),
    select: REVIEW_SELECT,
  });
  return r ? reviewToDTO(r) : null;
}

async function findOrCreateReview(userId: string, week: string) {
  const select = { id: true, closedAt: true } as const;
  const existing = await prisma.review.findUnique({
    where: weekKey(userId, week),
    select,
  });
  if (existing) return existing;
  try {
    return await prisma.review.create({
      data: { userId, weekStart: toDbDate(week) },
      select,
    });
  } catch (e) {
    // A concurrent first note created it between the read and the insert.
    if (!isUniqueViolation(e)) throw e;
    return prisma.review.findUniqueOrThrow({
      where: weekKey(userId, week),
      select,
    });
  }
}

export async function addNote(
  userId: string,
  week: string,
  input: { kind: NoteKind; content: string },
): Promise<ReviewNoteDTO> {
  const review = await findOrCreateReview(userId, week);
  if (review.closedAt) throw new Error(REVIEW_CLOSED);
  const max = await prisma.reviewNote.aggregate({
    where: { reviewId: review.id, kind: input.kind },
    _max: { order: true },
  });
  const note = await prisma.reviewNote.create({
    data: {
      reviewId: review.id,
      userId,
      kind: input.kind,
      content: input.content,
      order: (max._max.order ?? 0) + 1,
    },
    select: NOTE_SELECT,
  });
  return noteToDTO(note);
}

/** Throws unless the note is the user's and its week is still open. */
async function assertEditable(userId: string, id: string): Promise<void> {
  const note = await prisma.reviewNote.findFirst({
    where: { id, userId },
    select: { review: { select: { closedAt: true } } },
  });
  if (!note) throw new Error("Note not found");
  if (note.review.closedAt) throw new Error(REVIEW_CLOSED);
}

export async function updateNote(
  userId: string,
  id: string,
  content: string,
): Promise<ReviewNoteDTO> {
  await assertEditable(userId, id);
  const note = await prisma.reviewNote.update({
    where: { id },
    data: { content },
    select: NOTE_SELECT,
  });
  return noteToDTO(note);
}

export async function moveNote(
  userId: string,
  id: string,
  input: { kind: NoteKind; order: number },
): Promise<ReviewNoteDTO> {
  await assertEditable(userId, id);
  const note = await prisma.reviewNote.update({
    where: { id },
    data: { kind: input.kind, order: input.order },
    select: NOTE_SELECT,
  });
  return noteToDTO(note);
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  await assertEditable(userId, id);
  await prisma.reviewNote.delete({ where: { id } });
}

/**
 * Closes the week. Each chosen action note becomes an ordinary Inbox task
 * planned for the next week's Sunday, and the note records which task it
 * became. Notes still in the unsorted pile move to the pile of the next week
 * that is open, so closing never loses a thought and never waits on sorting.
 * Everything happens in one transaction, so a failure leaves the week open
 * with no tasks created and no notes moved.
 */
export async function closeReview(
  userId: string,
  week: string,
  actionNoteIds: string[],
): Promise<ReviewDTO> {
  const ids = [...new Set(actionNoteIds)];
  if (ids.length > MAX_CARRIED) {
    throw new Error(`At most ${MAX_CARRIED} actions can be carried`);
  }
  const inboxId = await getInboxId(userId);
  const dueDate = toDbDate(addDays(week, 7));

  const reviewId = await prisma.$transaction(async (tx) => {
    const review = await tx.review.findUnique({
      where: weekKey(userId, week),
      select: {
        id: true,
        closedAt: true,
        notes: {
          where: { id: { in: ids }, kind: "action" },
          select: { id: true, content: true, order: true },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!review) throw new Error("Review not found");
    if (review.closedAt) throw new Error(REVIEW_CLOSED);
    if (review.notes.length !== ids.length) {
      throw new Error("Only this week's action notes can be carried");
    }

    const max = await tx.task.aggregate({
      where: { userId, projectId: inboxId },
      _max: { order: true },
    });
    let order = max._max.order ?? 0;
    for (const note of review.notes) {
      order += 1;
      const task = await tx.task.create({
        data: { userId, projectId: inboxId, content: note.content, dueDate, order },
        select: { id: true },
      });
      await tx.reviewNote.update({
        where: { id: note.id },
        data: { carriedTaskId: task.id },
      });
    }
    const unsorted = await tx.reviewNote.findMany({
      where: { reviewId: review.id, kind: "unsorted" },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (unsorted.length > 0) {
      // Skip weeks already closed: notes parked there could never be edited.
      const select = { id: true, closedAt: true } as const;
      let target = addDays(week, 7);
      let next = await tx.review.findUnique({ where: weekKey(userId, target), select });
      while (next?.closedAt) {
        target = addDays(target, 7);
        next = await tx.review.findUnique({ where: weekKey(userId, target), select });
      }
      next ??= await tx.review.create({
        data: { userId, weekStart: toDbDate(target) },
        select,
      });
      const maxNext = await tx.reviewNote.aggregate({
        where: { reviewId: next.id, kind: "unsorted" },
        _max: { order: true },
      });
      let pileOrder = maxNext._max.order ?? 0;
      for (const n of unsorted) {
        pileOrder += 1;
        await tx.reviewNote.update({
          where: { id: n.id },
          data: { reviewId: next.id, order: pileOrder },
        });
      }
    }

    await tx.review.update({
      where: { id: review.id },
      data: { closedAt: new Date() },
    });
    return review.id;
  });

  const closed = await prisma.review.findUniqueOrThrow({
    where: { id: reviewId },
    select: REVIEW_SELECT,
  });
  return reviewToDTO(closed);
}

/**
 * One-off tasks completed on a user-local day in `from..to` (inclusive),
 * oldest first. Routine days are left out: they are habits, and the Activity
 * grid already shows them.
 *
 * The query is widened by a day on each side because a local day's
 * completions can be stamped up to 14 hours before its UTC midnight or 12
 * hours after the next; the exact day is settled after conversion.
 */
export async function listCompletedBetween(
  userId: string,
  from: string,
  to: string,
  tz: string,
): Promise<TaskDTO[]> {
  const rows = await prisma.task.findMany({
    where: {
      userId,
      status: "completed",
      routineId: null,
      completedAt: {
        gte: toDbDate(addDays(from, -1)),
        lt: toDbDate(addDays(to, 2)),
      },
    },
    orderBy: { completedAt: "asc" },
    select: TASK_SELECT,
  });
  return rows
    .filter((r) => {
      const day = dateStrInTz(r.completedAt!, tz);
      return day >= from && day <= to;
    })
    .map(taskToDTO);
}
