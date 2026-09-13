import type { Metadata } from "next";
import "./globals.css";

const themeInitializationScript = `
  (() => {
    let theme = "light";
    try {
      const storedTheme = window.localStorage.getItem("swim-theme");
      theme = storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    } catch {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.dataset.theme = theme;
  })();
`;

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
