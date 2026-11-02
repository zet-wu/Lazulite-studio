import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PackagingPanel} from './PackagingPanel';
import {createProjectDocument} from '../domain/project-document';
import {createLine} from '../domain/lyric-document';
import {prepareSug} from '../adapters/sug';
import {prepareNicokara} from '../adapters/nicokara';
import {issueLocation} from './output-messages';
afterEach(cleanup);
it('uses a neutral zero-line state, validates a blank line, and keeps explicit karaoke export blocked',async()=>{
 const project=createProjectDocument();project.lyrics.lines=[];
 const props={project,document:project.lyrics,locateIssue:vi.fn()};
 const view=render(<PackagingPanel {...props}/>);
 await screen.findByText('暂无歌词可校验');
 expect(screen.queryByText('所有格式通过')).toBeNull();
 for(const result of [prepareSug(project,'empty'),prepareNicokara(project,'empty')]) {
  expect(result.files).toHaveLength(0);
  expect(result.issues).toContainEqual(expect.objectContaining({code:'output-configuration',karaokeSettings:true}));
  expect(issueLocation(result.issues[0])).toBe('卡拉 OK 输出设置');
 }
 const next={...project,karaoke:{...project.karaoke,outputs:[]},lyrics:{...project.lyrics,lines:[createLine('')]}};
 view.rerender(<PackagingPanel {...props} project={next} document={next.lyrics}/>);
 await waitFor(()=>expect(screen.queryByText('暂无歌词可校验')).toBeNull());
 await waitFor(()=>expect(screen.getAllByText(/输出配置/).length).toBeGreaterThan(0));
 view.rerender(<PackagingPanel {...props}/>);
 await screen.findByText('暂无歌词可校验');
 expect(screen.queryByText(/输出配置/)).toBeNull();
});
