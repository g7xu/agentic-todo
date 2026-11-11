"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  answerAgent,
  handToAgent,
  listTaskActivity,
  takeBackFromAgent,
} from "@/lib/data/agent-tasks";
import type { TaskActivityDTO, TaskDTO } from "@/lib/types";

/** The user's side of the agent hand-off (docs/AGENT-TASKS.md). */

const id = z.string().uuid();
const answer = z.string().trim().min(1).max(5000);

export async function handToAgentAction(taskId: string): Promise<TaskDTO> {
  const user = await requireUser();
  return handToAgent(user.id, id.parse(taskId));
}

export async function takeBackFromAgentAction(taskId: string): Promise<TaskDTO> {
  const user = await requireUser();
  return takeBackFromAgent(user.id, id.parse(taskId));
}

export async function answerAgentAction(
  taskId: string,
  text: string,
): Promise<TaskDTO> {
  const user = await requireUser();
  return answerAgent(user.id, id.parse(taskId), answer.parse(text));
}

export async function listTaskActivityAction(
  taskId: string,
): Promise<TaskActivityDTO[]> {
  const user = await requireUser();
  return listTaskActivity(user.id, id.parse(taskId));
}
