import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {VocalUpload} from './VocalUpload';
import {studioApi,uploadMusic,vocalApi} from '../adapters/http/client';
vi.mock('../adapters/http/client',()=>({studioApi:{discardUpload:vi.fn().mockResolvedValue({})},uploadMusic:vi.fn(),vocalApi:{offset:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(duration=120000){
 vi.mocked(uploadMusic).mockResolvedValue({id:'upload',duration_ms:duration} as never);
 const submit=vi.fn().mockResolvedValue(true);
 const view=render(<VocalUpload projectId="p" sourceAssetId="source" durationMs={120000} available={false} disabled={false} submit={submit}/>);
 fireEvent.change(view.container.querySelector('input[type=file]')!,{target:{files:[new File(['audio'],'external.wav')]}});
 return {submit,view};
}
it.each([120000,118763])('always opens offset dialog for duration %s, applies zero and releases staging',async duration=>{
 const {submit}=mount(duration);const field=await screen.findByRole('spinbutton');expect(field).toHaveValue(0);expect(vocalApi.offset).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'应用'}));await waitFor(()=>expect(submit).toHaveBeenCalledWith('upload',0));await waitFor(()=>expect(studioApi.discardUpload).toHaveBeenCalledWith('upload'));
});
it('keeps manual input when an estimate arrives late or cannot determine a uniform offset',async()=>{
 let finish!:(value:{offset_ms:number|null})=>void;vi.mocked(vocalApi.offset).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 mount();const field=await screen.findByRole('spinbutton');fireEvent.click(screen.getByRole('button',{name:'自动计算偏移'}));fireEvent.change(field,{target:{value:'-3451'}});
 await act(async()=>finish({offset_ms:1237}));expect(field).toHaveValue(-3451);
 fireEvent.click(screen.getByRole('button',{name:'自动计算偏移'}));await act(async()=>finish({offset_ms:null}));expect(field).toHaveValue(-3451);expect(screen.getByText('无法确定统一偏移，请手动调整')).toBeVisible();
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
