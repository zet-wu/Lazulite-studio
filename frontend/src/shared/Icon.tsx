// Lucide SVGs: https://github.com/lucide-icons/lucide/tree/440a1e1dfb1e712505308da46bead3c28b1f1398/icons
// ISC and Feather MIT notices: public/third-party/lucide-LICENSE.txt
const icons = {
  "save": <><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" /></>,
  "undo": <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" /></>,
  "redo": <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" /></>,
  "refresh": <><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></>,
  "cloud": <><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></>,
  "pencil": <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>,
  "target": <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  "lyric-list": <><path d="M16 5H3" /><path d="M11 12H3" /><path d="M11 19H3" /><path d="M21 16V5" /><circle cx="18" cy="16" r="3" /></>,
  "folder": <><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></>,
  "check": <><path d="M20 6 9 17l-5-5" /></>,
  "warning": <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  "music": <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  "skip": <><path d="M21 4v16" /><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" /></>,
  "chevron": <><path d="m9 18 6-6-6-6" /></>,
  "search": <><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></>,
  "play": <><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /></>,
  "pause": <><rect x="14" y="3" width="5" height="18" rx="1" /><rect x="5" y="3" width="5" height="18" rx="1" /></>,
  "dots": <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
  "back": <><path d="m15 18-6-6 6-6" /></>,
  "trash": <><path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  "add": <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  "up": <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
  "down": <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  "close": <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  "minus": <><path d="M5 12h14" /></>,
};

type IconName = keyof typeof icons | 'karaoke' | 'sync-dot' | 'sync-beat';

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  if (name === 'sync-dot' || name === 'sync-beat') return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16">
    {name === 'sync-dot' ? <circle cx="8" cy="8" r="2.5" fill="currentColor"/> : <rect x="6.5" y="2" width="3" height="12" rx="1" fill="currentColor"/>}
  </svg>;
  if (name === 'karaoke') return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="currentColor"><path d="M1.8 2.3 3.5.7C5 2.3 5.5 3.8 5.5 5.4v2.1L9 4.1h3.6L8.8 7.8l5.6 7.2h-3.3L6.9 9.7l-1.4 1.4V15H3V5.5q0-1.7-1.2-3.2Z" /></svg>;
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}
