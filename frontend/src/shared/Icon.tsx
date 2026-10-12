type PathIconName = "save" | "undo" | "redo" | "refresh" | "cloud" | "pencil" | "target" | "karaoke" | "lyric-list" | "folder" | "check" | "warning" | "music" | "skip" | "chevron" | "search" | "play" | "pause" | "dots" | "back" | "trash" | "add" | "up" | "down" | "close" | "minus";

export function Icon({ name, size = 16 }: { name: PathIconName | "sync-dot" | "sync-beat"; size?: number }) {
  if (name === 'sync-dot' || name === 'sync-beat') return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16">
    {name === 'sync-dot' ? <circle cx="8" cy="8" r="2.5" fill="currentColor"/> : <rect x="6.5" y="2" width="3" height="12" rx="1" fill="currentColor"/>}
  </svg>;
  const paths: Record<PathIconName, string> = {
    save: "M2 1h9l3 3v11H2ZM5 1v5h6V1M5 15V9h6v6",
    undo: "M6 3 2 7l4 4M2 7h7a4 4 0 0 1 4 4v2",
    redo: "m10 3 4 4-4 4M14 7H7a4 4 0 0 0-4 4v2",
    refresh: "M13 5a6 6 0 1 0 1 5M13 1v4H9",
    cloud: "M4 12a3 3 0 0 1-.5-6A4 4 0 0 1 11 6a3 3 0 0 1 1 6Z",
    pencil: "m3 10 7-7 3 3-7 7-4 1Zm6-6 3 3",
    target: "M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    karaoke: "M1.8 2.3 3.5.7C5 2.3 5.5 3.8 5.5 5.4v2.1L9 4.1h3.6L8.8 7.8l5.6 7.2h-3.3L6.9 9.7l-1.4 1.4V15H3V5.5q0-1.7-1.2-3.2Z",
    'lyric-list': "M2 4h.01M2 8h.01M2 12h.01M6 4h8M6 8h6M6 12h7",
    folder: "M1 5V3h4.5l2 2H15v8.5H1Z",
    check: "m3 8 3 3 7-7",
    warning: "M8 2 1 14h14ZM8 6v4M8 12h.01",
    music: "M6 11V3l7-1v8M6 5l7-1M6 11c0 3-4 3-4 1s4-3 4-1M13 10c0 3-4 3-4 1s4-3 4-1",
    skip: "m3 3 7 5-7 5ZM12 3v10",
    close: "M4 4l8 8M12 4l-8 8",
    minus: "M3 8h10",
    add: "M8 3v10M3 8h10",
    up: "m3 10 5-5 5 5Z",
    down: "m3 6 5 5 5-5Z",
    chevron: "M6 4l4 4-4 4",
    search: "m11 11 4 4m-1.8-6.3A4.5 4.5 0 1 1 4.5 4.5a4.5 4.5 0 0 1 8.7 0Z",
    play: "m4 3 8 5-8 5Z",
    pause: "M6 4v8M10 4v8",
    dots: "M5 8h.01M8 8h.01M11 8h.01",
    trash: "M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4",
    back: "m10 4-4 4 4 4",
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} fill={name === 'karaoke' ? 'currentColor' : 'none'} stroke={name === 'karaoke' ? 'none' : undefined} /></svg>;
}
