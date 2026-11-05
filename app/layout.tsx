import 'katex/dist/katex.min.css'
import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Hanken_Grotesk, STIX_Two_Text } from 'next/font/google'

const reading = STIX_Two_Text({ subsets: ['latin', 'greek'], variable: '--font-reading', display: 'swap' })
const ui = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-ui', display: 'swap' })

export const metadata: Metadata = {
  title: 'A clock made from one atom',
  description: 'An interactive 3D simulation of the ²⁷Al⁺ quantum-logic clock, step by step, from the published experiments.',
}
export const viewport: Viewport = { themeColor: '#171130' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${reading.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  )
}
