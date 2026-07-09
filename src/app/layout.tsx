import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agentic Todoist",
  description: "A Todoist-style task manager with an agentic chat assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning: the auth UI's bundled next-themes sets
  // style/class on <html> before hydration; without this React logs a
  // hydration-mismatch warning on every page load in dev.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) stamp
          data-* attributes onto <body> before hydration. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <Providers>
          <AuthProvider>{children}</AuthProvider>
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
