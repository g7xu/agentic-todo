import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/legal";
import { resourceUrl } from "@/lib/oauth/config";
import screenshot from "../../public/screenshot-upcoming.png";

const PROMPTS = [
  "What's due this week?",
  "Add 'renew passport' for Friday with a deadline of the 20th.",
  "Move everything due today that isn't priority 1 to tomorrow.",
  "How is my daily review routine going over the last four weeks?",
];

const CAN_DO = [
  {
    title: "Read and change your tasks and projects",
    body: "Add, edit, complete, reschedule and delete, singly or in bulk. Every write asks for your approval in the client first.",
  },
  {
    title: "Tell a planned date from a deadline",
    body: "“Move everything to tomorrow” moves the day you planned to do it, never the day it is actually due.",
  },
  {
    title: "Reason about your routines",
    body: "Recurring tasks keep a completion history your agent can read, so “how is my daily review going?” gets a real answer.",
  },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 font-mono text-[13px] leading-relaxed">
      {children}
    </pre>
  );
}

/** The signed-out front page. Signed-in visitors never see it; `/` sends
 * them to the Upcoming board. */
export function Landing() {
  const mcpUrl = resourceUrl();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Image src="/icon-192.png" alt="" width={28} height={28} className="rounded-md" />
          agenticTODO
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      </header>

      <section className="py-12 sm:py-20">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          A free todo list with no AI inside.
        </h1>
        <p className="text-muted-foreground mt-3 text-2xl tracking-tight sm:text-3xl">
          Your coding agent is the AI.
        </p>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-pretty sm:text-lg">
          agenticTODO holds your tasks, projects and routines and never calls a
          model. Connect the agent you already work in, Claude Code or
          claude.ai, and it reads and edits your list through a remote MCP
          server behind real OAuth. It stays free because there is no AI bill
          to pass on.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/auth/sign-in">Sign in with Google or email</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#connect">Connect your agent</Link>
          </Button>
        </div>
      </section>

      {/* Phase 5 of the launch plan replaces this still with the demo clip. */}
      <section className="overflow-hidden rounded-xl border shadow-sm">
        <Image
          src={screenshot}
          alt="The Upcoming board: a column per day holding tasks with priorities, deadlines and routines"
          priority
          sizes="(min-width: 1024px) 1024px, 100vw"
        />
      </section>

      <section id="connect" className="scroll-mt-8 py-16 sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight">Connect your agent</h2>
        <div className="mt-8 grid gap-10 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <h3 className="font-medium">Claude Code</h3>
            <p className="text-muted-foreground text-sm">Register the server once, for all your projects:</p>
            <Code>{`claude mcp add -s user --transport http agentictodo ${mcpUrl}`}</Code>
            <p className="text-muted-foreground text-sm">
              Then run <code className="font-mono">/mcp</code>, choose{" "}
              <strong>agentictodo</strong> → <strong>Authenticate</strong>, and
              approve in your browser. Signing in there creates your account if
              you don&apos;t have one.
            </p>
          </div>
          <div className="grid content-start gap-3">
            <h3 className="font-medium">claude.ai</h3>
            <p className="text-muted-foreground text-sm">
              Customize → Connectors → Add custom connector, and enter:
            </p>
            <Code>{mcpUrl}</Code>
            <p className="text-muted-foreground text-sm">
              Choose <strong>Sign in now</strong> and approve. Other MCP clients
              that support OAuth should connect the same way; Claude Code and
              claude.ai are the ones we test.
            </p>
          </div>
        </div>

        <h3 className="mt-12 font-medium">Then ask</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <li key={p} className="rounded-md border px-3 py-2 text-sm">
              &ldquo;{p}&rdquo;
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t py-16 sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight">What your agent can do</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          {CAN_DO.map((c) => (
            <div key={c.title}>
              <h3 className="font-medium">{c.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t py-16 sm:py-24">
        <h2 className="text-2xl font-semibold tracking-tight">Yours, and free</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-3">
          <div>
            <h3 className="font-medium">No AI inside</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              The app never calls a model. The thinking happens in the agent you
              already pay for, or in the free one you already use.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Your data stays yours</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Download everything as JSON, or delete your account and every
              connected app in one step. No ads, no analytics, no tracking.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Open source</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              MIT-licensed, built by one engineer who wanted a todo list that
              lives where the work happens.{" "}
              <a href={REPO_URL} className="text-foreground underline underline-offset-2">
                Read the source on GitHub
              </a>
              , or run your own copy.
            </p>
          </div>
        </div>
      </section>

      <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t py-8 text-sm">
        <span>© 2026 Guoxuan Xu</span>
        <nav className="flex gap-4">
          <a href={REPO_URL} className="hover:text-foreground">GitHub</a>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/support" className="hover:text-foreground">Support</Link>
        </nav>
      </footer>
    </div>
  );
}
