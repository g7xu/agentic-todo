import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { issuer } from "@/lib/oauth/config";
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

const DESCRIPTION =
  "A free todo list with no AI inside. Your coding agent is the AI.";

export const metadata: Metadata = {
  // Absolute URLs for the Open Graph image and canonical links; `issuer()`
  // is the one place the public URL is resolved.
  metadataBase: new URL(issuer()),
  title: { default: "agenticTODO", template: "%s · agenticTODO" },
  description: DESCRIPTION,
  applicationName: "agenticTODO",
  appleWebApp: { capable: true, title: "agenticTODO", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    siteName: "agenticTODO",
    title: "agenticTODO",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
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
