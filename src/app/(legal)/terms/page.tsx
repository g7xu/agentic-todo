import type { Metadata } from "next";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of service · agenticTODO",
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p className="text-muted-foreground text-sm">Last updated {LEGAL_UPDATED}</p>

      <p>
        These terms are an agreement between you and Guoxuan Xu, who runs
        agenticTODO (&ldquo;the service&rdquo;). By creating an account or
        using the service, you accept them. If you do not accept them, do not
        use the service.
      </p>

      <h2>Who can use it</h2>
      <p>
        You must be at least 16 years old and able to form a binding
        agreement. You are responsible for your account and for everything
        done with it, including by apps you connect.
      </p>

      <h2>Your content</h2>
      <p>
        Your tasks, projects and routines belong to you. You give us
        permission to store, copy and display them only as needed to run the
        service for you. That permission ends when you delete the content or
        your account, apart from the short restore history described in the{" "}
        <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Connected apps</h2>
      <p>
        You can authorize apps, such as Claude, to read and change your data
        through MCP. Those apps act on your instructions and under their own
        providers&apos; terms. We are not responsible for what a connected app
        does with your data or your account, including changes or deletions it
        makes. You can disconnect any app at any time in Settings.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not:</p>
      <ul>
        <li>break the law, or use the service to store or share unlawful content;</li>
        <li>try to access other users&apos; data or probe, scan or test the service&apos;s security without permission;</li>
        <li>overload the service, for example with automated requests far beyond normal personal use;</li>
        <li>resell the service or create accounts in bulk.</li>
      </ul>
      <p>
        We may suspend or close accounts that break these rules. Where
        possible, we will tell you first and give you a chance to download
        your data.
      </p>

      <h2>A free service, provided as is</h2>
      <p>
        The service is free and run by one person. It may change, be
        unavailable at times, or lose data. Keep your own copy of anything
        important; Settings → Your data lets you download everything. If we
        shut the service down, we will give at least 30 days&apos; notice so
        you can export your data.
      </p>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
        AVAILABLE&rdquo;, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
        IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE AND NON-INFRINGEMENT.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT THE LAW ALLOWS, WE ARE NOT LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR
        FOR ANY LOSS OF DATA, PROFITS OR GOODWILL, ARISING FROM YOUR USE OF
        THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO US$50.
        Some places do not allow these limits, so they may not apply to you.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can stop at any time by deleting your account in Settings. These
        terms then end, except for the sections that by their nature should
        survive, such as the warranty disclaimer and limitation of liability.
      </p>

      <h2>Open source</h2>
      <p>
        The source code of agenticTODO is licensed separately under the MIT
        License. These terms cover the hosted service, not the code.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of California,
        USA, without regard to its conflict-of-law rules. Disputes will be
        heard in the state or federal courts located in California, unless
        the law where you live gives you the right to bring them locally.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If these terms change, the date at the top changes with it. For
        significant changes we will notify you by email or in the app before
        they take effect. Continuing to use the service after that means you
        accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </>
  );
}
