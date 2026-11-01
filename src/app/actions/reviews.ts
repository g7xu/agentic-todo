"use server";

import type { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  addNote,
  closeReview,
  deleteNote,
  moveNote,
  updateNote,
} from "@/lib/data/reviews";
import type { ReviewDTO, ReviewNoteDTO } from "@/lib/types";
import {
  addNoteSchema,
  carriedIdsSchema,
  moveNoteSchema,
  noteContentSchema,
  noteIdSchema,
  weekSchema,
} from "@/lib/validation/reviews";

export async function addNoteAction(
  week: string,
  input: z.input<typeof addNoteSchema>,
): Promise<ReviewNoteDTO> {
  const user = await requireUser();
  return addNote(user.id, weekSchema.parse(week), addNoteSchema.parse(input));
}

export async function updateNoteAction(
  id: string,
  content: string,
): Promise<ReviewNoteDTO> {
  const user = await requireUser();
  return updateNote(user.id, noteIdSchema.parse(id), noteContentSchema.parse(content));
}

export async function moveNoteAction(
  id: string,
  input: z.input<typeof moveNoteSchema>,
): Promise<ReviewNoteDTO> {
  const user = await requireUser();
  return moveNote(user.id, noteIdSchema.parse(id), moveNoteSchema.parse(input));
}

export async function deleteNoteAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteNote(user.id, noteIdSchema.parse(id));
}

export async function closeReviewAction(
  week: string,
  actionNoteIds: string[],
): Promise<ReviewDTO> {
  const user = await requireUser();
  return closeReview(
    user.id,
    weekSchema.parse(week),
    carriedIdsSchema.parse(actionNoteIds),
  );
}
