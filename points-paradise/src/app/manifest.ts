import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Points & Paradise',
    short_name: 'Paradise',
    description: 'Private Chase Ultimate Rewards travel intelligence',
    start_url: '/discover',
    display: 'standalone',
    background_color: '#0b1422',
    theme_color: '#0b1422',
    // On Android, an installed app shows up in the share menu: shared TikTok links open the Ideas page.
    share_target: { action: '/ideas', method: 'get', params: { title: 'title', text: 'text', url: 'url' } },
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
