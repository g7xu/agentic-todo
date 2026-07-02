import type { UIMessage } from "ai";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * v1 single thread per user: resolve the user's one conversation, creating it on
 * the first message (TDD §3). The `@@unique([userId])` makes the upsert safe
 * under concurrent first messages.
 */
export async function resolveConversationId(userId: string): Promise<string> {
  const convo = await prisma.conversation.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true },
  });
  return convo.id;
}

/** Load the persisted UIMessages for the user's conversation (oldest first). */
export async function loadMessages(userId: string): Promise<UIMessage[]> {
  const convo = await prisma.conversation.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!convo) return [];
  const rows = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage["role"],
    parts: r.content as unknown as UIMessage["parts"],
  }));
}

/**
 * Idempotent upsert of a UIMessage on the text `id` (TDD §6.1) — re-persisting
 * a message never duplicates a row.
 */
export async function saveMessage(
  conversationId: string,
  userId: string,
  message: UIMessage,
): Promise<void> {
  const content = message.parts as unknown as Prisma.InputJsonValue;
  await prisma.message.upsert({
    where: { id: message.id },
    update: { content, role: message.role },
    create: {
      id: message.id,
      conversationId,
      userId,
      role: message.role,
      content,
    },
  });
}
