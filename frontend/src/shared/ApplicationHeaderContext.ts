import {createContext} from 'react';
export const ApplicationHeaderContext = createContext<{host: HTMLDivElement | null; setProjectHeader: (active: boolean) => void} | null>(null);
