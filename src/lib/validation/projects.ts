import { z } from "zod";

export const projectNameSchema = z.string().trim().min(1).max(120);
export const idSchema = z.string().uuid();
