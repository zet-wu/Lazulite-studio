type IconName = "chevron" | "search" | "play" | "pause" | "dots" | "back";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    chevron: "M6 4l4 4-4 4",
    search: "m11 11 4 4m-1.8-6.3A4.5 4.5 0 1 1 4.5 4.5a4.5 4.5 0 0 1 8.7 0Z",
    play: "m6 4 9 4-9 4Z",
    pause: "M6 4v8M10 4v8",
    dots: "M5 8h.01M8 8h.01M11 8h.01",
    back: "m10 4-4 4 4 4",
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
