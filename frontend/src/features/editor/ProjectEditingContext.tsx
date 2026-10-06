import { createContext, useContext } from 'react';
import { createProjectEditing } from '../../domain/project-editing';
export const ProjectEditingContext = createContext(createProjectEditing());
export const useProjectEditing = () => useContext(ProjectEditingContext);
