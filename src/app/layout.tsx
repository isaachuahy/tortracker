import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Tortracker · Your grocery notebook",
  description:
    "A private grocery notebook for receipts, spending and local price comparisons.",
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
