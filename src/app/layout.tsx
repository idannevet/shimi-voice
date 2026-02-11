import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'שימי Voice — שיחה קולית',
  description: 'ממשק שיחה קולית עם שימי',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
