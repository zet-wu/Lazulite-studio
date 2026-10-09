import { createContext, useContext } from 'react';
import type { ProjectDocument, ProjectCommand } from '../domain/project-document';
export const KaraokeContext = createContext<{ project: ProjectDocument; apply: (command: ProjectCommand) => void; locked: boolean } | null>(null);
export const useKaraokeProject = () => useContext(KaraokeContext);
