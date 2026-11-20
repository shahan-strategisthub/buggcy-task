import { useState } from 'react';
import { ArrowUpRight, FlaskConical, Play } from 'lucide-react';
import type { Scenario, Task, User, Workload } from '../shared.js';
import { send, useResource } from './api.js';

type Mode = 'race' | 'stale';
type Entry = { taskId: number; result: string; error?: boolean };

export function Review({ user, revision, refresh }: { user?: User; revision: number; refresh: () => void }) {
  const [runs, setRuns] = useState<Partial<Record<Mode, { scenario: Scenario; entries: Entry[] }>>>({});
  const [busy, setBusy] = useState<Mode>();
  const [failure, setFailure] = useState('');

  async function run(mode: Mode) {
    if (!user || busy) return;
    setBusy(mode); setFailure('');
    try {
      const scenario = await send<Scenario>(`/demo/scenarios/${mode}`, user.id);
      const entries: Entry[] = [];
      async function assign(taskId: number) {
        try {
          const task = await send<Task>(`/tasks/${taskId}/assign`, scenario.creator.id);
          return { taskId, result: `Assigned to ${task.assignee_name}` };
        } catch (error) {
          return { taskId, result: (error as Error).message, error: true };
        }
      }
      if (mode === 'race') entries.push(...await Promise.all(scenario.taskIds.map(assign)));
      else for (const taskId of scenario.taskIds) entries.push(await assign(taskId));
      setRuns((current) => ({ ...current, [mode]: { scenario, entries } }));
    } catch (error) { setFailure((error as Error).message); }
    finally { refresh(); setBusy(undefined); }
  }

  return <>
    <div className="page-heading"><div><h1>Review lab</h1><p>Run repeatable assignment scenarios with fresh tasks and bidders.</p></div></div>
    {failure && <p className="alert" role="alert">{failure}</p>}
    <div className="review-grid">
      <section className="panel review-panel">
        <h2><FlaskConical size={19} /> Capacity race</h2>
        <p className="muted">Alex has 10 h available and offered 5 h and 7 h on two tasks. Send both assignment requests at the same time and see which one wins the available capacity.</p>
        <button className="button primary" onClick={() => void run('race')} disabled={!user || !!busy}><Play size={16} /> {busy === 'race' ? 'Running…' : 'Run capacity race'}</button>
        {runs.race && <Results mode="race" {...runs.race} revision={revision} />}
      </section>
      <section className="panel review-panel">
        <h2><FlaskConical size={19} /> Stale bid</h2>
        <p className="muted">Jamie offered 3 h before taking on 13 h of work. Once Jamie has 2 h left, assign the second task and see whether Taylor’s 4 h bid wins.</p>
        <button className="button primary" onClick={() => void run('stale')} disabled={!user || !!busy}><Play size={16} /> {busy === 'stale' ? 'Running…' : 'Run stale bid'}</button>
        {runs.stale && <Results mode="stale" {...runs.stale} revision={revision} />}
      </section>
    </div>
  </>;
}

function Results({ mode, scenario, entries, revision }: { mode: Mode; scenario: Scenario; entries: Entry[]; revision: number }) {
  const workload = useResource<Workload>(`/users/${scenario.bidder.id}/workload`, revision);
  const names = mode === 'race' ? ['Task X', 'Task Y'] : ['Reserve work', 'Choose a bidder'];
  return <div className="lab-results" aria-live="polite">
    <ul className="metric-list">{entries.map(({ taskId, result, error }, index) => <li key={taskId}>
      <a href={`#task/${taskId}`}>{names[index]} <ArrowUpRight size={13} /></a>
      <span className={error ? 'late' : 'good'}>{result}</span>
    </li>)}</ul>
    {workload?.data && <p className="muted">{scenario.bidder.name} has <strong>{workload.data.remaining} h</strong> remaining.</p>}
  </div>;
}
