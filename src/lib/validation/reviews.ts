import { z } from "zod";
import { isWeekStart, MAX_CARRIED, NOTE_KINDS } from "@/lib/reviews";
import { dateStr } from "@/lib/validation/tasks";

/** A review week, named by the Sunday that starts it. */
export const weekSchema = dateStr.refine(isWeekStart, "not the Sunday starting a week");

export const noteKindSchema = z.enum(NOTE_KINDS);

export const noteIdSchema = z.string().uuid();

export const noteContentSchema = z.string().trim().min(1).max(500);

export const addNoteSchema = z.object({
  kind: noteKindSchema,
  content: noteContentSchema,
});

export const moveNoteSchema = z.object({
  kind: noteKindSchema,
  order: z.number().finite(),
});

export const carriedIdsSchema = z.array(noteIdSchema).max(MAX_CARRIED);
