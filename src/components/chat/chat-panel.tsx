"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import {
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { Inbox, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TASKS_KEY } from "@/hooks/use-tasks";
import { ReviewPanel } from "@/components/chat/review-panel";
import { PlanPanel } from "@/components/chat/plan-panel";
import type { TaskDTO } from "@/lib/types";

/** Loose view of a tool UI part for the fields we read across states. */
type ToolPart = {
  type: string;
  state: string;
  input?: { id?: string; ids?: string[]; content?: string };
  approval?: { id: string };
};

/** Controlled chat drawer. The toggle lives in the app header (AppShell). */
export function ChatPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="bg-background fixed top-0 right-0 z-40 flex h-full w-96 flex-col border-l shadow-xl">
      <ChatLoader onClose={onClose} />
    </div>
  );
}

function ChatLoader({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["chat-messages"],
    queryFn: async (): Promise<UIMessage[]> => {
      const res = await fetch("/api/chat");
      if (!res.ok) return [];
      return ((await res.json()) as { messages: UIMessage[] }).messages;
    },
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground p-4 text-sm">Loading chat…</div>
    );
  }
  return <ChatThread initialMessages={data ?? []} onClose={onClose} />;
}

function ChatThread({
  initialMessages,
  onClose,
}: {
  initialMessages: UIMessage[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const {
    messages,
    sendMessage,
    status,
    error,
    addToolApprovalResponse,
    clearError,
  } = useChat({
    messages: initialMessages,
    // Once the user answers all pending tool approvals, auto-send the resume
    // request so the server executes the approved tool (AI SDK v7 HITL).
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });

  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  function resolveTitle(id: string): string {
    const tasks = queryClient.getQueryData<TaskDTO[]>(TASKS_KEY) ?? [];
    return tasks.find((t) => t.id === id)?.content ?? `${id.slice(0, 8)}… (not in current view)`;
  }

  function respondApproval(approvalId: string, approved: boolean) {
    addToolApprovalResponse({ id: approvalId, approved });
    // onFinish may not fire on approval-paused turns, so refresh here too.
    queryClient.invalidateQueries({ queryKey: TASKS_KEY });
  }

  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">Assistant</span>
        <button
          aria-label="Close assistant"
          onClick={onClose}
          className="hover:bg-accent rounded p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <PlanPanel
        onCreated={() =>
          sendMessage({
            text: "I just added several tasks to my Inbox from a brain-dump. Let's process my Inbox — go through each one at a time and help me make it concrete and actionable, asking insightful questions, then update it.",
          })
        }
      />

      <ReviewPanel />

      <div className="border-b px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() =>
            sendMessage({
              text: "Let's process my inbox. Go through my Inbox tasks one at a time and help me make each one concrete and actionable — ask insightful questions, then update it.",
            })
          }
        >
          <Inbox className="size-4" /> Review Inbox
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && (
          <p className="text-muted-foreground">
            Ask about your tasks, or tell me to add, move, complete, or delete
            them. Try “what’s due this week?”
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex flex-col gap-2",
              m.role === "user" ? "items-end" : "items-start",
            )}
          >
            {m.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted",
                    )}
                  >
                    {part.text}
                  </div>
                );
              }
              if (isToolUIPart(part)) {
                const tp = part as unknown as ToolPart;
                const name = getToolName(part);
                if (tp.state === "approval-requested" && tp.approval) {
                  const ids = tp.input?.ids ?? (tp.input?.id ? [tp.input.id] : []);
                  const approvalId = tp.approval.id;
                  return (
                    <div
                      key={i}
                      className="bg-card w-full rounded-lg border p-3 text-xs"
                    >
                      <div className="mb-2 font-medium">Confirm: {name}</div>
                      <ul className="mb-2 list-disc pl-4">
                        {ids.map((id) => (
                          <li key={id}>{resolveTitle(id)}</li>
                        ))}
                      </ul>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => respondApproval(approvalId, true)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respondApproval(approvalId, false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="text-muted-foreground text-xs">
                    · {name}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
        {busy && <p className="text-muted-foreground text-xs">Thinking…</p>}
      </div>

      {error && (
        <div className="border-t bg-red-50 px-4 py-2 text-xs text-red-700">
          {error.message || "Something went wrong."}{" "}
          <button className="underline" onClick={() => clearError()}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 border-t p-3">
        <textarea
          value={input}
          rows={1}
          placeholder="Message the assistant…   (Shift+Enter for newline)"
          className="border-input placeholder:text-muted-foreground focus-visible:ring-ring max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button size="icon" disabled={busy} onClick={submit}>
          <Send className="size-4" />
        </Button>
      </div>
    </>
  );
}
