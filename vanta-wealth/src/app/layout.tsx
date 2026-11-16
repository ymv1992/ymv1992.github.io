import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Vanta Wealth', template: '%s · Vanta Wealth' },
  description: 'Private investment intelligence and asset-building command center.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b0b0c' }

// Applies the saved theme before first paint. Dark is the default look.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('vw-theme');document.documentElement.classList.toggle('dark',t!=='light')}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
