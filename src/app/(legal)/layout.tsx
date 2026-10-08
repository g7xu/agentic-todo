import Link from "next/link";

const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
];

/**
 * Shell for the pages a signed-out visitor must be able to read. The proxy
 * matcher in `src/proxy.ts` exempts each of these paths from sign-in.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          agenticTODO
        </Link>
        <nav className="text-muted-foreground flex gap-4 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </header>
      <article className="text-[15px] leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-medium [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </article>
    </div>
  );
}
