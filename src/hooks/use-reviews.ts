"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addNoteAction,
  closeReviewAction,
  deleteNoteAction,
  moveNoteAction,
  updateNoteAction,
} from "@/app/actions/reviews";
import { TASKS_KEY } from "@/hooks/use-tasks";
import type {
  NoteKind,
  ReviewDTO,
  ReviewNoteDTO,
  ReviewSummaryDTO,
  TaskDTO,
} from "@/lib/types";

export const REVIEWS_KEY = ["reviews"] as const;

export type ReviewList = { thisWeek: string; reviews: ReviewSummaryDTO[] };

export type ReviewWeek = {
  week: string;
  thisWeek: string;
  review: ReviewDTO | null;
  completed: TaskDTO[];
};

const weekKey = (week: string) => [...REVIEWS_KEY, "week", week] as const;

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${what}`);
  return (await res.json()) as T;
}

export function useReviews() {
  return useQuery({
    queryKey: [...REVIEWS_KEY, "list"],
    queryFn: () => getJson<ReviewList>("/api/reviews", "reviews"),
    refetchOnWindowFocus: "always",
  });
}

/** Always refetched on mount: its completed-task list changes whenever a task
 * is completed anywhere else in the app. */
export function useReviewWeek(week: string) {
  return useQuery({
    queryKey: weekKey(week),
    queryFn: () => getJson<ReviewWeek>(`/api/reviews/${week}`, "the review"),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
}

type Ctx = { prev?: ReviewWeek };

/** Optimistic note edits for one week's board, rolled back on failure. */
function useNoteMutation<V, R>(
  week: string,
  mutationFn: (v: V) => Promise<R>,
  apply: (notes: ReviewNoteDTO[], v: V) => ReviewNoteDTO[],
  failure: string,
) {
  const qc = useQueryClient();
  const key = weekKey(week);
  return useMutation<R, Error, V, Ctx>({
    mutationFn,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ReviewWeek>(key);
      if (prev) {
        const review: ReviewDTO = prev.review ?? {
          id: "temp-review",
          weekStart: week,
          closedAt: null,
          notes: [],
        };
        qc.setQueryData<ReviewWeek>(key, {
          ...prev,
          review: { ...review, notes: apply(review.notes, v) },
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      console.error(`${failure}:`, e);
      toast.error(failure);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: REVIEWS_KEY }),
  });
}

export function useAddNote(week: string) {
  return useNoteMutation(
    week,
    (v: { kind: NoteKind; content: string }) => addNoteAction(week, v),
    (notes, v) => {
      const inKind = notes.filter((n) => n.kind === v.kind);
      const order = inKind.length ? Math.max(...inKind.map((n) => n.order)) + 1 : 1;
      return [
        ...notes,
        {
          id: `temp-${crypto.randomUUID()}`,
          kind: v.kind,
          content: v.content,
          order,
          carriedTaskId: null,
          createdAt: new Date().toISOString(),
        },
      ];
    },
    "Couldn’t add the note",
  );
}

export function useUpdateNote(week: string) {
  return useNoteMutation(
    week,
    (v: { id: string; content: string }) => updateNoteAction(v.id, v.content),
    (notes, v) => notes.map((n) => (n.id === v.id ? { ...n, content: v.content } : n)),
    "Couldn’t save the note",
  );
}

export function useMoveNote(week: string) {
  return useNoteMutation(
    week,
    (v: { id: string; kind: NoteKind; order: number }) =>
      moveNoteAction(v.id, { kind: v.kind, order: v.order }),
    (notes, v) =>
      notes.map((n) => (n.id === v.id ? { ...n, kind: v.kind, order: v.order } : n)),
    "Couldn’t move the note",
  );
}

export function useDeleteNote(week: string) {
  return useNoteMutation(
    week,
    (id: string) => deleteNoteAction(id),
    (notes, id) => notes.filter((n) => n.id !== id),
    "Couldn’t delete the note",
  );
}

/** Carried actions become tasks, so the task views refresh too. */
export function useCloseReview(week: string) {
  const qc = useQueryClient();
  return useMutation<ReviewDTO, Error, string[]>({
    mutationFn: (ids) => closeReviewAction(week, ids),
    onSuccess: (_r, ids) => {
      toast(
        ids.length === 0
          ? "Week closed"
          : `Week closed · ${ids.length} ${ids.length === 1 ? "task" : "tasks"} added to Inbox`,
      );
    },
    onError: (e) => {
      console.error("Couldn’t close the week:", e);
      toast.error("Couldn’t close the week");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: REVIEWS_KEY });
      qc.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
}
