import type { Metadata } from "next";
import { CONTACT_EMAIL } from "@/lib/legal";
import { resourceUrl } from "@/lib/oauth/config";

export const metadata: Metadata = {
  title: "Support · agenticTODO",
};

export default function SupportPage() {
  const mcpUrl = resourceUrl();

  return (
    <>
      <h1>Support</h1>

      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. One
        person runs agenticTODO and reads every message, so a reply can take a
        few days. Say which app you were using (for example Claude Code or
        claude.ai), what you expected, and what happened instead.
      </p>

      <h2>Connect Claude Code</h2>
      <p>Register the server once:</p>
      <pre className="bg-muted mt-3 overflow-x-auto rounded-md p-3 font-mono text-sm">
        claude mcp add -s user --transport http agentictodo {mcpUrl}
      </pre>
      <p>
        Then run <code className="font-mono">/mcp</code> in Claude Code, choose{" "}
        <strong>agentictodo</strong>, then <strong>Authenticate</strong>, and
        approve the request in your browser.
      </p>

      <h2>Connect claude.ai</h2>
      <p>
        Go to Customize → Connectors → Add custom connector, enter{" "}
        <code className="font-mono break-all">{mcpUrl}</code>, and approve the
        request.
      </p>

      <h2>Claude asks me to sign in again</h2>
      <p>
        A connection that goes unused for 30 days expires. Run{" "}
        <code className="font-mono">/mcp</code> and choose{" "}
        <strong>Authenticate</strong> again.
      </p>

      <h2>Disconnect an app</h2>
      <p>
        Settings → Connected apps → Disconnect. The app loses access
        immediately.
      </p>

      <h2>Download or delete your data</h2>
      <p>
        Settings → Your data. Deleting your account removes everything at
        once and cannot be undone. See the{" "}
        <a href="/privacy">privacy policy</a> for what is stored.
      </p>

      <h2>Report a security problem</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with
        &ldquo;Security&rdquo; in the subject, and please don&apos;t disclose
        it publicly until it is fixed.
      </p>
    </>
  );
}
