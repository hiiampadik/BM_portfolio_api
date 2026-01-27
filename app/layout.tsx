import React from 'react';

export const metadata = {
  title: "BM Portfolio API Gateway",
  description: "ISR Revalidation Gateway",
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
