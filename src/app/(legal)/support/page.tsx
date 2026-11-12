import type { Metadata } from "next";
import { CONTACT_EMAIL, REPO_URL } from "@/lib/legal";
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
        few days. Say which AI agent or app you were using, what you
        expected, and what happened instead.
      </p>

      <h2>Connect a terminal agent</h2>
      <p>
        Add a remote (HTTP) MCP server named agentictodo with the URL below.
        In Claude Code, for example:
      </p>
      <pre className="bg-muted mt-3 overflow-x-auto rounded-md p-3 font-mono text-sm">
        claude mcp add -s user --transport http agentictodo {mcpUrl}
      </pre>
      <p>
        Then authenticate the <strong>agentictodo</strong> server from your
        agent&apos;s MCP settings and approve the request in your browser.
      </p>

      <h2>Connect a chat app</h2>
      <p>
        In the app&apos;s connector settings, add a custom connector, enter{" "}
        <code className="font-mono break-all">{mcpUrl}</code>, and approve the
        request.
      </p>

      <h2>My agent asks me to sign in again</h2>
      <p>
        A connection that goes unused for 30 days expires. Authenticate the
        server again from your agent&apos;s MCP settings.
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

      <h2>Source code</h2>
      <p>
        agenticTODO is open source under the MIT license:{" "}
        <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a>. Bug
        reports and pull requests are welcome there.
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
