import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Engine",
  description: "Automated, on-strategy content for one brand — review then ship.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
