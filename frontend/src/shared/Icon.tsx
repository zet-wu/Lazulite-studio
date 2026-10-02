type IconName = "chevron" | "search" | "play" | "pause" | "dots" | "back" | "trash" | "add" | "up" | "down" | "close" | "minus";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
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
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
