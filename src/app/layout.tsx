import type { Metadata } from "next";
import { Figtree, Fraunces, Geist_Mono } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marginalia",
  description: "Ask how a public GitHub repository works. Answers stay tied to the commit you pin.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-heading text-2xl tracking-tight">Marginalia</p>
              <p className="text-sm text-muted-foreground">
                Read-only answers for public GitHub repositories, pinned to a commit.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Public repositories. Answers cite the pinned commit.</p>
          </div>
        </header>
        <TooltipProvider>
          <main className="flex flex-1 flex-col">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
