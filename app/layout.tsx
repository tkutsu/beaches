import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beaches",
  description:
    "Bathing water quality across Europe, season by season since 1990, from the European Environment Agency's Bathing Water Directive data.",
  applicationName: "Beaches",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
