import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@forge/bridge';

const EVENT_LABELS = {
  'cycle-started': 'Follow-up started',
  'cycle-cancelled': 'Follow-up cancelled',
  'cycle-paused': 'Follow-up paused',
  'cycle-resumed': 'Follow-up resumed',
  'cycle-restarted': 'Follow-up restarted',
  'participants-added': 'Participants added',
  'reminder-comment-sent': 'Reminder sent',
  'reminder-transitioned': 'Reminder status changed',
  'reminder-completed': 'Reminder completed',
  'final-comment-sent': 'Final customer message sent',
  'auto-transitioned': 'Auto-close completed',
  'processing-error': 'Processing failed'
};

function formatDate(value) {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function eventDetail(item) {
  if (item.type === 'processing-error') return item.message || 'The follow-up could not be processed.';
  if (item.reason) return item.reason;
  if (item.type === 'reminder-comment-sent' || item.type === 'reminder-completed') return `Reminder ${(Number(item.reminderIndex) || 0) + 1}`;
  if (item.destinationStatusName) return `Moved to ${item.destinationStatusName}`;
  if (item.participantCount) return `${item.participantCount} participant${item.participantCount === 1 ? '' : 's'}`;
  return '';
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
    const rows = data?.activity ?? [];
    if (filter === 'errors') return rows.filter((item) => item.type === 'processing-error');
    if (filter === 'reminders') return rows.filter((item) => item.type.includes('reminder'));
    if (filter === 'closures') return rows.filter((item) => item.type === 'auto-transitioned' || item.type === 'final-comment-sent');
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
        <div><h2>Run history</h2><p className="muted">Latest follow-up activity for this Jira project. Audit records are retained for 180 days.</p></div>
        <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="activity-filters">
        {['all', 'reminders', 'closures', 'errors'].map((value) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All activity' : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      {error && <div className="notice">{error}</div>}
      {activity.length === 0 ? <div className="empty">No matching activity has been recorded yet.</div> :
        <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Date / time</th><th>Ticket</th><th>Rule</th><th>Event</th><th>Details</th><th>Result</th></tr></thead><tbody>
          {activity.map((item, index) => <tr key={`${item.timestamp}-${item.issueId}-${item.type}-${index}`}>
            <td>{formatDate(item.timestamp)}</td>
            <td><strong>{item.issueKey || item.issueId}</strong></td>
            <td>{item.ruleName || item.ruleId || '—'}</td>
            <td>{EVENT_LABELS[item.type] || item.type}</td>
            <td>{eventDetail(item) || '—'}</td>
            <td><span className={`result-pill ${item.type === 'processing-error' ? 'result-error' : 'result-success'}`}>{item.type === 'processing-error' ? 'Failed' : 'Success'}</span></td>
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
