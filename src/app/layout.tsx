import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdStamp — Post the content. Get the stamp. Get paid.",
  description:
    "On-chain payouts for user-generated marketing content, judged by decentralized AI on GenLayer.",
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
