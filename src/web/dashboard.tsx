import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, ChartNoAxesColumn, Layers3, Trophy } from 'lucide-react';
import { statusLabels } from '../shared.js';
import type { Stats } from '../shared.js';
import { useResource } from './api.js';

const dates = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function Dashboard({ revision }: { revision: number }) {
  const result = useResource<Stats>('/dashboard/stats', revision);
  const stats = result?.data;
  return <>
    <div className="page-heading"><div><h1>Dashboard</h1><p>Task progress, bid estimates, and work that needs attention.</p></div></div>
    {!result && <p className="muted" role="status">Loading dashboard…</p>}
    {result?.error && <p role="alert" className="alert">{result.error}</p>}
    {stats && <div className="dashboard-grid">
      <section className="panel">
        <h2><ChartNoAxesColumn size={19} /> Average bid by complexity</h2>
        <p className="muted">Mean hours offered across all bids.</p>
        <div className="chart" aria-label="Average bid hours by complexity">
          <ResponsiveContainer width="100%" height={235}>
            <BarChart data={stats.average_by_complexity} margin={{ top: 10, left: -25, right: 12, bottom: 0 }}>
              <CartesianGrid stroke="#ebe8f2" vertical={false} />
              <XAxis dataKey="complexity" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip formatter={(value) => [`${value} h`, 'Average']} labelFormatter={(value) => `Complexity ${value}`} />
              <Bar dataKey="average_hours" fill="var(--accent-chart)" radius={[8, 8, 0, 0]} maxBarSize={52} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="chart-values" aria-label="Average bid values">
          {stats.average_by_complexity.map(({ complexity, average_hours }) => <li key={complexity}><span>{complexity}/5</span>
            <strong>{average_hours === null ? 'No bids' : `${average_hours} h`}</strong></li>)}
        </ul>
      </section>
      <section className="panel">
        <h2><Layers3 size={19} /> Tasks by status</h2>
        <p className="muted">{stats.by_status.reduce((sum, row) => sum + row.count, 0)} tasks across the board</p>
        <ul className="metric-list">{stats.by_status.map(({ status, count }) => <li key={status}>
          <span className="metric-label"><span className={`state-dot ${status}`} />{statusLabels[status]}</span><strong>{count}</strong>
        </li>)}</ul>
      </section>
      <section className="panel">
        <h2><Trophy size={19} /> Most tasks completed</h2>
        {stats.top_users.length ? <ol className="metric-list">{stats.top_users.map(({ id, name, completed }) =>
          <li key={id}><span>{name}</span><strong>{completed} {completed === 1 ? 'task' : 'tasks'}</strong></li>)}</ol>
          : <p className="muted">No completed tasks yet.</p>}
      </section>
      <section className="panel">
        <h2><CalendarClock size={19} /> Overdue without bids</h2>
        {stats.overdue_without_bids.length ? <ul className="metric-list">{stats.overdue_without_bids.map(({ id, title, deadline }) =>
          <li key={id}><a href={`#task/${id}`}>{title}</a><span className="late">{dates.format(new Date(deadline))}</span></li>)}</ul>
          : <p className="muted">No overdue tasks without bids.</p>}
      </section>
    </div>}
  </>;
}
