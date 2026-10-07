import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy · agenticTODO",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="text-muted-foreground text-sm">Last updated {LEGAL_UPDATED}</p>

      <p>
        agenticTODO is a free task manager run by Guoxuan Xu, an individual
        developer. This policy explains what the service stores about you,
        why, who else handles it, and how to get it back or delete it.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>We store your account details and the tasks, projects and routines you create.</li>
        <li>We do not sell your data, show ads, or use analytics or tracking tools.</li>
        <li>The app itself sends nothing to any AI service. An AI app reads your tasks only after you connect it.</li>
        <li>You can download everything or delete your account at any time from Settings.</li>
      </ul>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Account:</strong> your email address and name. If you sign
          in with Google, also the profile picture link Google provides and
          the tokens Google issues to complete sign-in. We do not use those
          tokens to access anything else in your Google account. If you sign
          in with a password, we store a hash of it, never the password
          itself.
        </li>
        <li>
          <strong>Sessions:</strong> for each signed-in device, the IP address
          and browser description it signed in from, so sessions can be
          recognized and ended.
        </li>
        <li>
          <strong>Your content:</strong> tasks (text, notes, priority, dates,
          deadlines, time estimates and time spent, completion status),
          projects, routines with their completion history, and your
          timezone.
        </li>
        <li>
          <strong>Connected apps:</strong> for each app you authorize through
          MCP, such as Claude, its name, the permissions you granted, and when
          it was connected and last used. The access tokens we issue to it
          are stored only in hashed form.
        </li>
        <li>
          <strong>Sign-in codes:</strong> one-time email codes, which expire
          within minutes.
        </li>
        <li>
          <strong>Request logs:</strong> our hosting provider records each
          request&apos;s path, status, time and browser description. These logs
          are kept for one hour.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run the service: to sign you in, show and change your tasks,
        let the apps you connect act on your behalf, and keep the service
        secure. Under the GDPR, the legal basis is performing our agreement
        with you (the <a href="/terms">terms</a>), and our legitimate interest
        in preventing abuse for sessions and logs.
      </p>

      <h2>Apps you connect</h2>
      <p>
        When you connect an app such as Claude, it can read and change your
        tasks, projects and routines within the permissions you approve. What
        that app does with the data, including any AI processing, is governed
        by its provider&apos;s own privacy policy, not this one. You can
        disconnect any app at any time in Settings → Connected apps, which
        takes effect immediately.
      </p>

      <h2>Who else handles your data</h2>
      <ul>
        <li><strong>Vercel</strong> hosts the app (servers in the United States).</li>
        <li><strong>Neon</strong> hosts the database and the sign-in system (servers in the United States, on Amazon Web Services).</li>
        <li><strong>Google</strong>, only if you choose to sign in with Google.</li>
        <li>An email delivery provider sends your sign-in codes.</li>
      </ul>
      <p>
        Your data is stored and processed in the United States. If you use the
        service from elsewhere, you agree to that transfer.
      </p>

      <h2>Cookies</h2>
      <p>
        The only cookies are the ones that keep you signed in. There are no
        analytics, advertising or tracking cookies.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data until you delete your account. Deleting it removes
        your content, connected apps and sign-in at once. Our database
        provider keeps a short restore history, so deleted data can remain
        recoverable there for up to 7 days before it is gone for good.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li><strong>Download your data:</strong> Settings → Your data → Download your data gives you everything as a JSON file.</li>
        <li><strong>Correct it:</strong> edit any task, project or routine in the app.</li>
        <li><strong>Delete it:</strong> Settings → Your data → Delete account.</li>
        <li>
          <strong>Anything else:</strong> email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Depending on
          where you live, you may also have the right to object to or restrict
          processing, and to complain to your data protection authority.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        The service is not for anyone under 16. If you believe a child under
        16 has an account, email us and we will delete it.
      </p>

      <h2>Security</h2>
      <p>
        Connections are encrypted, access tokens are stored hashed, and every
        request is limited to the signed-in user&apos;s own data. No system
        is perfectly secure; if a breach affects your data, we will tell you.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the date at the top changes with it. For
        significant changes we will also notify you by email or in the app
        before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </>
  );
}
