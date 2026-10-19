import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter'
import './globals.css'
import { ServiceWorker } from '@/components/service-worker'

export const metadata: Metadata = {
  title: { default: 'Points & Paradise', template: '%s · Points & Paradise' },
  description: 'Private Chase Ultimate Rewards travel intelligence.',
  applicationName: 'Points & Paradise',
  appleWebApp: { capable: true, title: 'Points & Paradise', statusBarStyle: 'black-translucent' },
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f4ec' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1422' },
  ],
}

// Applies the saved theme before first paint to avoid a flash of the wrong theme.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('pp-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
