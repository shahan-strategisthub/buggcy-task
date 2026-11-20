import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import { ArrowDown, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, ChevronDown, CircleAlert,
  Check, ChevronUp, CircleCheck, FileText, FlaskConical, Gavel, Inbox, LayoutGrid, LockKeyhole, MessageSquare,
  Plus, Radio, ScanEye, UserRoundCheck, X, Zap } from 'lucide-react';
import { statuses, statusLabels } from '../shared.js';
import type { Bid, Status, Task, User, Workload } from '../shared.js';
import { ApiError, send, useResource } from './api.js';
import { Review } from './review.js';

const Dashboard = lazy(() => import('./dashboard.js').then((module) => ({ default: module.Dashboard })));
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function dateLabel(value: string) { return dateFormat.format(new Date(value)); }
function initials(name: string) { return name.split(' ').slice(0, 2).map((word) => word[0]).join(''); }
function navigate(hash: string) { window.location.hash = hash; }

const laneIcons = {
  draft: FileText, open: Radio, bidding_closed: LockKeyhole, assigned: UserRoundCheck,
  in_progress: Zap, review: ScanEye, done: CircleCheck,
} satisfies Record<Status, typeof FileText>;

function Alert({ children }: { children: ReactNode }) {
  return <div className="alert" role="alert"><CircleAlert size={17} /> <span>{children}</span></div>;
}

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [section, setSection] = useState(window.location.hash);
  const [selected, setSelected] = useState(() => Number(sessionStorage.getItem('taskbid.user')));
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const refresh = useCallback(() => setRevision((previous) => previous + 1), []);
  const users = useResource<User[]>('/users', revision);
  const user = users?.data?.find(({ id }) => id === selected) ?? users?.data?.[0];
  const workload = useResource<Workload>(user ? `/users/${user.id}/workload` : null, revision);
  const taskId = /^#task\/(\d+)$/.exec(hash)?.[1];
  const page = section === '#dashboard' ? 'dashboard' : section === '#review' ? 'review' : 'board';

  useEffect(() => {
    const changePage = () => {
      const location = window.location.hash;
      setHash(location);
      if (!location.startsWith('#task/')) setSection(location);
    };
    window.addEventListener('hashchange', changePage);
    return () => window.removeEventListener('hashchange', changePage);
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    let timer: number | undefined;
    events.onopen = () => { setLive(true); refresh(); };
    events.onerror = () => setLive(false);
    events.onmessage = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => { timer = undefined; refresh(); }, 60);
    };
    const poll = window.setInterval(refresh, 30_000);
    return () => { events.close(); window.clearTimeout(timer); window.clearInterval(poll); };
  }, [refresh]);

  const selectUser = (id: number) => { setSelected(id); sessionStorage.setItem('taskbid.user', String(id)); };
  return <>
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#board"><span className="brand-icon"><Gavel size={20} /></span>TaskBid</a>
        <nav aria-label="Workspace">
          <a href="#board" aria-current={page === 'board' ? 'page' : undefined}><LayoutGrid size={17} /> Task board</a>
          <a href="#dashboard" aria-current={page === 'dashboard' ? 'page' : undefined}><BarChart3 size={17} /> Dashboard</a>
          <a href="#review" aria-current={page === 'review' ? 'page' : undefined}><FlaskConical size={17} /> Review lab</a>
        </nav>
        <div className="header-end">
          <span className={live ? 'connection live' : 'connection'} title={live ? 'Changes update automatically' : 'Trying to reconnect'}>
            <span className="signal" />{live ? 'Live' : 'Reconnecting'}
          </span>
          <UserSwitcher selected={user} users={users?.data ?? []} onChange={selectUser} />
        </div>
      </div>
    </header>
    <main className="main">
      {users?.error && <Alert>{users.error} <button className="text-button" onClick={refresh}>Try again</button></Alert>}
      {page === 'dashboard' && <Suspense fallback={<p className="muted" role="status">Loading dashboard…</p>}><Dashboard revision={revision} /></Suspense>}
      {page === 'review' && <Review user={user} revision={revision} refresh={refresh} />}
      {page === 'board' && <Board revision={revision} workload={workload?.data} user={user} onCreate={() => setNewTask(true)} />}
    </main>
    {taskId && <TaskDetail key={`${taskId}/${user?.id}`} id={taskId} user={user} workload={workload?.data}
      revision={revision} refresh={refresh} close={() => navigate(`#${page}`)} />}
    {newTask && user && <CreateTask user={user} close={() => setNewTask(false)} created={(task) => {
      setNewTask(false); refresh(); navigate(`#task/${task.id}`);
    }} />}
  </>;
}

function UserSwitcher({ selected, users, onChange }: {
  selected?: User; users: User[]; onChange: (id: number) => void;
}) {
  return <Select.Root value={selected ? String(selected.id) : ''} onValueChange={(value) => onChange(Number(value))} disabled={!selected}>
    <Select.Trigger className="user-trigger" aria-label="Switch demo user">
      <span className="avatar user-avatar" data-tone={selected && selected.id % 4} aria-hidden="true">
        {selected ? initials(selected.name) : '–'}
      </span>
      <span className="user-trigger-copy">
        <span className="user-trigger-caption">Demo user</span>
        <span className="user-trigger-name"><Select.Value placeholder="Loading…">{selected?.name}</Select.Value></span>
      </span>
      <Select.Icon asChild><ChevronDown className="user-trigger-arrow" size={15} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="user-menu" position="popper" align="end" sideOffset={8} collisionPadding={12} aria-label="Demo users">
        <div className="user-menu-heading" aria-hidden="true">Switch demo user</div>
        <Select.ScrollUpButton className="user-menu-scroll"><ChevronUp size={15} /></Select.ScrollUpButton>
        <Select.Viewport className="user-menu-viewport">
          {users.map((user) => <Select.Item className="user-option" key={user.id} value={String(user.id)} textValue={user.name}>
            <span className="avatar user-avatar" data-tone={user.id % 4} aria-hidden="true">{initials(user.name)}</span>
            <Select.ItemText>{user.name}</Select.ItemText>
            <Select.ItemIndicator className="user-option-check"><Check size={15} strokeWidth={2.5} aria-hidden="true" /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="user-menu-scroll"><ChevronDown size={15} /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

function Board({ revision, workload, user, onCreate }: {
  revision: number; workload?: Workload; user?: User; onCreate: () => void;
}) {
  const tasks = useResource<Task[]>('/tasks', revision);
  return <>
    <div className="page-heading board-heading">
      <div><h1>Task board</h1><p>Post work, compare bids, and track tasks through delivery.</p></div>
      <div className="heading-actions">
        {workload && <div className="capacity">
          <strong>{workload.remaining} h available</strong>
          <progress aria-label="Allocated capacity" max={workload.max_capacity} value={workload.workload} />
          <small>{workload.workload} of {workload.max_capacity} h allocated</small>
        </div>}
        <button className="button primary" onClick={onCreate} disabled={!user}><Plus size={18} /> New task</button>
      </div>
    </div>
    {tasks?.error && <Alert>{tasks.error}</Alert>}
    <div className="board-scroll" role="region" aria-label="Task board columns" tabIndex={0}>
      <div className="board">
        {statuses.map((status) => {
          const group = tasks?.data?.filter((task) => task.status === status) ?? [];
          const Icon = laneIcons[status];
          return <section className={`lane tone-${status}`} key={status} aria-label={statusLabels[status]}>
            <header className="lane-heading">
              <span className="lane-icon"><Icon size={15} aria-hidden="true" /></span>
              <h2>{statusLabels[status]}</h2><span className="count">{group.length}</span>
            </header>
            <div className="lane-body">
              {group.map((task) => <TaskCard key={task.id} task={task} />)}
              {!group.length && <p className="lane-empty"><Inbox size={17} aria-hidden="true" />{tasks ? 'No tasks' : 'Loading…'}</p>}
            </div>
          </section>;
        })}
      </div>
    </div>
  </>;
}

function TaskCard({ task }: { task: Task }) {
  const overdue = task.status !== 'done' && Date.parse(task.deadline) < Date.now();
  return <a className="task-card" href={`#task/${task.id}`}>
    <div className="card-title"><h3>{task.title}</h3><ArrowUpRight size={15} aria-hidden="true" /></div>
    <span className="card-complexity">
      <span className="complexity-meter" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((level) => <i key={level} className={level <= task.complexity ? 'filled' : undefined} />)}
      </span>
      Complexity {task.complexity}/5
    </span>
    <time dateTime={task.deadline} className={`deadline${overdue ? ' late' : ''}`}>
      <CalendarDays size={14} aria-hidden="true" /> <span className="sr-only">{overdue ? 'Overdue, due ' : 'Due '}</span>
      {dateLabel(task.deadline)}
    </time>
    <div className="card-bottom">
      <span className="card-bids"><MessageSquare size={13} aria-hidden="true" />{task.bid_count} {task.bid_count === 1 ? 'bid' : 'bids'}</span>
      {task.lowest_bid !== null && <strong className="lowest-bid" title="Lowest bid">
        <ArrowDown size={12} aria-hidden="true" /><span className="sr-only">Lowest bid </span>{task.lowest_bid} h
      </strong>}
    </div>
  </a>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); close(); }} aria-labelledby="dialog-title">
    <div className="dialog-inner">
      <header className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close} autoFocus><X size={21} /></button>
      </header>
      {children}
    </div>
  </dialog>;
}

function CreateTask({ user, close, created }: { user: User; close: () => void; created: (task: Task) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const deadline = new Date(String(data.get('deadline')));
    if (!Number.isFinite(deadline.getTime())) { setError('Enter a valid deadline.'); return; }
    setPending(true); setError('');
    try {
      created(await send<Task>('/tasks', user.id, {
        title: data.get('title'), description: data.get('description'),
        complexity: Number(data.get('complexity')), deadline: deadline.toISOString(),
      }));
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <Modal title="New task" close={close}>
    <form className="create-form" onSubmit={submit}>
      <label>Title<input name="title" required maxLength={120} placeholder="What needs to be done?" /></label>
      <label>Description<textarea name="description" required maxLength={3000} rows={4} placeholder="Describe the work and what done looks like." /></label>
      <div className="form-grid">
        <label>Complexity<select name="complexity" defaultValue="3">{[1, 2, 3, 4, 5].map((level) => <option key={level}>{level}</option>)}</select></label>
        <label>Deadline<input type="datetime-local" name="deadline" required /></label>
      </div>
      {error && <Alert>{error}</Alert>}
      <footer className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button>
        <button className="button primary" disabled={pending}>{pending ? 'Creating…' : 'Create draft'}</button></footer>
    </form>
  </Modal>;
}

const transitions = {
  draft: ['open', 'Open bidding'],
  open: ['bidding_closed', 'Close bidding'],
  assigned: ['in_progress', 'Start work'],
  in_progress: ['review', 'Send to review'],
  review: ['done', 'Mark done'],
} as const;
const bidLabels = { pending: 'Pending', accepted: 'Accepted', not_selected: 'Not selected' };

function TaskDetail({ id, user, workload, revision, refresh, close }: {
  id: string; user?: User; workload?: Workload; revision: number; refresh: () => void; close: () => void;
}) {
  const taskResult = useResource<Task>(`/tasks/${id}`, revision);
  const bidResult = useResource<Bid[]>(`/tasks/${id}/bids`, revision);
  const task = taskResult?.data;
  const [hours, setHours] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const isOwner = task?.creator_id === user?.id;
  const isAssignee = task?.assignee_id === user?.id;
  const ownBid = bidResult?.data?.some((bid) => bid.bidder_id === user?.id);
  const transition = task && task.status in transitions ? transitions[task.status as keyof typeof transitions] : undefined;
  const canAdvance = task && transition && (task.status === 'assigned' || task.status === 'in_progress' ? isAssignee : isOwner);
  const canAssign = task?.status === 'bidding_closed' && isOwner;
  const invalidHours = hours !== '' && (!Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > (workload?.remaining ?? 0));

  async function act(kind: 'bid' | 'assign' | 'advance') {
    if (!user || !task || pending) return;
    setPending(true); setMessage(undefined);
    try {
      if (kind === 'bid') {
        await send(`/tasks/${id}/bids`, user.id, { hours: Number(hours) });
        setHours(''); setMessage({ text: 'Your bid was placed.' });
      } else {
        const updated = kind === 'assign'
          ? await send<Task>(`/tasks/${id}/assign`, user.id)
          : await send<Task>(`/tasks/${id}/status`, user.id, { status: transition?.[0] }, 'PATCH');
        setMessage({ text: kind === 'assign' ? `Assigned to ${updated.assignee_name}.` : `Moved to ${statusLabels[updated.status].toLowerCase()}.` });
      }
    } catch (error) {
      setMessage({ error: true, text: error instanceof ApiError && error.code === 'CAPACITY_CHANGED'
        ? 'Your remaining capacity changed while this task was open. Check your updated hours and try again.'
        : (error as Error).message });
    } finally { setPending(false); refresh(); }
  }
  return <Modal title={task?.title ?? 'Task details'} close={close}>
    {taskResult?.error && <Alert>{taskResult.error}</Alert>}
    {!taskResult && <p className="muted" role="status">Loading task details…</p>}
    {task && <>
      <div className="task-meta"><span className="badge"><span className={`state-dot ${task.status}`} />{statusLabels[task.status]}</span>
        <span className="complexity">Complexity {task.complexity}/5</span></div>
      <p className="description">{task.description}</p>
      <dl className="details-list">
        <div><dt>Created by</dt><dd>{task.creator_name}</dd></div>
        <div><dt>Deadline</dt><dd>{fullDate.format(new Date(task.deadline))}</dd></div>
        {task.assignee_name && <div><dt>Assigned to</dt><dd>{task.assignee_name}</dd></div>}
      </dl>
      <section className="bid-section" aria-label="Bids">
        <div className="section-heading"><h3>Bids</h3><span className="muted">Lowest hours first</span></div>
        {bidResult?.error && <Alert>{bidResult.error}</Alert>}
        {!bidResult && <p className="muted">Loading bids…</p>}
        {bidResult?.data?.length === 0 && <p className="empty-bids">No bids yet.</p>}
        {!!bidResult?.data?.length && <ul className="bid-list">{bidResult.data.map((bid) =>
          <li key={bid.id}><span className="avatar">{initials(bid.bidder_name)}</span>
            <span className="bid-name"><strong>{bid.bidder_name}</strong><small>{fullDate.format(new Date(bid.placed_at))}</small></span>
            <span className={`bid-state ${bid.status}`}>{bidLabels[bid.status]}</span><strong>{bid.hours} h</strong></li>)}</ul>}
      </section>
      {task.status === 'open' && user && <section className="bid-form-area">
        {isOwner && <p className="muted">As the creator, you can close bidding when you’re ready.</p>}
        {!isOwner && ownBid && <p className="muted">You’ve already bid on this task.</p>}
        {!isOwner && ownBid === false && workload && <form className="bid-form" onSubmit={(event) => {
          event.preventDefault(); if (!invalidHours && hours) void act('bid');
        }}>
          <label>Hours to complete<input type="number" min="1" max={workload.remaining} step="1" required value={hours}
            onChange={(event) => setHours(event.target.value)} aria-describedby="bid-capacity" disabled={workload.remaining === 0} /></label>
          <button className="button primary" disabled={pending || invalidHours || !hours || workload.remaining === 0}><Gavel size={16} /> Place bid</button>
          <small id="bid-capacity" className={invalidHours ? 'late' : 'muted'}>{workload.remaining} h available. Enter a whole number within your capacity.</small>
        </form>}
      </section>}
      {message && (message.error ? <Alert>{message.text}</Alert> : <p className="notice" role="status">{message.text}</p>)}
      {(canAdvance || canAssign) && <footer className="dialog-actions">
        <button className="button primary" disabled={pending} onClick={() => void act(canAssign ? 'assign' : 'advance')}>
          {canAssign ? 'Auto-assign' : transition?.[1]} <ArrowRight size={16} />
        </button>
      </footer>}
    </>}
  </Modal>;
}
