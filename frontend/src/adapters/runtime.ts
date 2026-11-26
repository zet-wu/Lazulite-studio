/** Vite replaces these values at build time. The desktop runtime is the default. */
export const isBrowserRuntime = import.meta.env.VITE_STUDIO_RUNTIME === 'browser';
export const desktopDownloadUrl = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL || 'https://github.com/zet-wu/Lazulite-studio/releases';
export const siteUrl = import.meta.env.VITE_SITE_URL || desktopDownloadUrl;
