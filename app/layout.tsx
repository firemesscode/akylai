import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AkylBot",
  description: "AI-ассистент медиа «Тимур и команда» из Татарстана",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
