import { useEffect } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SelectionProvider, useEditorSelection } from './SelectionContext';
afterEach(cleanup);
function Probe() {
 const shared=useEditorSelection()!;
 useEffect(()=>{shared.setSelectedSegments(ids=>ids.filter(id=>id==='s'));},[shared.setSelectedSegments]);
 return <><output>{shared.effective?.kind ?? 'none'}</output>
 <button onClick={()=>shared.setSelection({kind:'lines',ids:['l'],activeId:'l',anchorId:'l'})}>line</button>
 <button onClick={()=>shared.setSelectedSegments(['s'])}>segment</button>
 <button onClick={()=>shared.setSelection(current=>current)}>cleanup lyrics</button></>;
}
it('cleanup effects preserve the other category and stable setters do not repeatedly reset selection',()=>{
 render(<SelectionProvider><Probe/></SelectionProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('none');
 fireEvent.click(screen.getByText('line'));expect(screen.getByRole('status')).toHaveTextContent('lines');
 fireEvent.click(screen.getByText('segment'));expect(screen.getByRole('status')).toHaveTextContent('segments');
 fireEvent.click(screen.getByText('cleanup lyrics'));expect(screen.getByRole('status')).toHaveTextContent('segments');
 fireEvent.click(screen.getByText('line'));expect(screen.getByRole('status')).toHaveTextContent('lines');
});
