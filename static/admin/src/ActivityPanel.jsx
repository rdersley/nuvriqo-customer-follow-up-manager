import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@forge/bridge';

function formatDate(value) {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function rowForActivity(item) {
  if (item.type === 'rule-check') {
    return {
      ...item,
      filters: item.filtersMatched ? 'Matched' : 'Not matched',
      actionText: item.action || 'None',
      tone: item.filtersMatched ? 'matched' : 'neutral'
    };
  }
  if (item.type === 'reminder-completed') {
    return {
      ...item,
      filters: 'Matched (active follow-up)',
      actionText: `Reminder ${(Number(item.reminderIndex) || 0) + 1} sent${item.destinationStatusName ? ` → ${item.destinationStatusName}` : ''}`,
      tone: 'action'
    };
  }
  if (item.type === 'auto-transitioned') {
    return {
      ...item,
      filters: 'Matched (active follow-up)',
      actionText: `Closed → ${item.destinationStatusName || 'final status'}`,
      tone: 'action'
    };
  }
  if (item.type === 'cycle-cancelled') {
    return {
      ...item,
      filters: item.filtersMatched === false ? 'Not matched' : 'No longer active',
      actionText: `Follow-up cancelled${item.reason ? ` — ${item.reason}` : ''}`,
      tone: 'neutral'
    };
  }
  if (item.type === 'processing-error') {
    return {
      ...item,
      filters: '—',
      actionText: item.message || 'Processing failed',
      tone: 'error'
    };
  }
  return null;
}

export default function ActivityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await invoke('getProjectActivity'));
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const activity = useMemo(() => {
    const rows = (data?.activity ?? []).map(rowForActivity).filter(Boolean);
    if (filter === 'checks') return rows.filter((item) => item.type === 'rule-check');
    if (filter === 'actions') return rows.filter((item) => ['reminder-completed', 'auto-transitioned', 'cycle-cancelled'].includes(item.type) || (item.type === 'rule-check' && item.action && item.action !== 'None' && !item.action.startsWith('None -')));
    if (filter === 'errors') return rows.filter((item) => item.type === 'processing-error');
    return rows;
  }, [data, filter]);

  if (loading && !data) return <section className="card"><h2>Run history</h2><div className="empty">Loading follow-up activity…</div></section>;
  if (error && !data) return <section className="card"><h2>Run history</h2><div className="notice">{error}</div></section>;

  const summary = data?.summary ?? {};
  const scheduler = data?.scheduler;
  const schedulerHealthy = scheduler?.status === 'success';

  return <>
    <section className="activity-stats">
      <div className="stat-card"><span>Last scheduler run</span><strong>{formatDate(scheduler?.completedAt)}</strong><small className={schedulerHealthy ? 'status-ok' : scheduler ? 'status-warn' : ''}>{scheduler ? (schedulerHealthy ? 'Successful' : 'Completed with errors') : 'Waiting for first recorded run'}</small></div>
      <div className="stat-card"><span>Active follow-ups</span><strong>{summary.activeFollowUps ?? 0}</strong><small>Currently being tracked</small></div>
      <div className="stat-card"><span>Reminders today</span><strong>{summary.remindersToday ?? 0}</strong><small>Customer messages sent</small></div>
      <div className="stat-card"><span>Auto-closes today</span><strong>{summary.autoClosesToday ?? 0}</strong><small>Final transitions completed</small></div>
      <div className="stat-card"><span>Failures today</span><strong>{summary.failuresToday ?? 0}</strong><small className={(summary.failuresToday ?? 0) > 0 ? 'status-warn' : 'status-ok'}>{(summary.failuresToday ?? 0) > 0 ? 'Needs attention' : 'No failures recorded'}</small></div>
    </section>

    {scheduler && <section className="card scheduler-card">
      <div><h2>Scheduler health</h2><p className="muted">The Forge scheduler records a heartbeat each time it checks active follow-ups.</p></div>
      <div className="scheduler-metrics">
        <span><strong>{scheduler.activeCyclesSeen ?? 0}</strong> cycles seen</span>
        <span><strong>{scheduler.processed ?? 0}</strong> processed</span>
        <span><strong>{scheduler.actions ?? 0}</strong> actions</span>
        <span><strong>{scheduler.failures ?? 0}</strong> failures</span>
      </div>
    </section>}

    <section className="card">
      <div className="section-head">
        <div><h2>Run history</h2><p className="muted">Shows when a ticket was checked, whether it matched the rule filters, and what action the app took.</p></div>
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="activity-filters">
        {['all', 'checks', 'actions', 'errors'].map((value) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All activity' : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      {error && <div className="notice">{error}</div>}
      {activity.length === 0 ? <div className="empty">No matching activity has been recorded yet.</div> :
        <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Date / time</th><th>Ticket</th><th>Rule</th><th>Filters</th><th>Action</th></tr></thead><tbody>
          {activity.map((item, index) => <tr key={`${item.timestamp}-${item.issueId}-${item.type}-${index}`}>
            <td>{formatDate(item.timestamp)}</td>
            <td><strong>{item.issueKey || item.issueId}</strong></td>
            <td>{item.ruleName || item.ruleId || '—'}</td>
            <td><span className={`result-pill ${item.filters === 'Matched' || item.filters?.startsWith('Matched (') ? 'result-success' : ''}`}>{item.filters}</span></td>
            <td>{item.tone === 'error' ? <span className="result-pill result-error">{item.actionText}</span> : item.actionText}</td>
          </tr>)}
        </tbody></table></div>}
    </section>

    <section className="card">
      <h2>Active follow-ups</h2>
      {(data?.activeCycles ?? []).length === 0 ? <div className="empty">No active follow-up cycles in this project.</div> :
        <div className="rules">{data.activeCycles.map((cycle) => <div className="rule" key={cycle.issueId}>
          <div><div className="rule-title">{cycle.issueKey}</div><div className="muted">{cycle.ruleName} · started {formatDate(cycle.startedAt)}{cycle.paused ? ' · paused' : ''}</div></div>
          {cycle.lastError && <span className="result-pill result-error">Last run failed</span>}
        </div>)}</div>}
    </section>
  </>;
}
