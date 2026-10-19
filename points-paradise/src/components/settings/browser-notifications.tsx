'use client'

import { useState } from 'react'

/** Checkbox that also asks the browser for notification permission when turned on. */
export function BrowserNotificationToggle({ defaultChecked }: { defaultChecked: boolean }) {
  const [checked, setChecked] = useState(defaultChecked)
  const [note, setNote] = useState<string | null>(null)
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="browserNotifications"
          checked={checked}
          onChange={async (e) => {
            const on = e.target.checked
            setChecked(on)
            setNote(null)
            if (!on) return
            if (!('Notification' in window)) {
              setNote('This browser does not support notifications. Alerts still appear in the app and by email.')
              return
            }
            const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
            if (result !== 'granted') {
              setChecked(false)
              setNote('Notifications are blocked for this site in your browser settings.')
            }
          }}
        />
        Show browser notifications while the app is open
      </label>
      {note && <p className="mt-1 text-xs text-warn">{note}</p>}
    </div>
  )
}
