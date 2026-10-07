import React, { useEffect, useMemo, useState } from 'react';
import { invoke, router } from '@forge/bridge';

function formatDate(value) {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function actionSummary(item) {
  if (item.type === 'reminder-completed') {
    const actions = [`Reminder ${(Number(item.reminderIndex) || 0) + 1}`];
    if (item.commentSent !== false) actions.push('Customer comment sent');
    if (item.participantCount > 0) actions.push(`${item.participantCount} participant${item.participantCount === 1 ? '' : 's'} added`);
    if (item.destinationStatusName) actions.push(`Status changed → ${item.destinationStatusName}`);
    return actions.join(' · ');
  }
  if (item.type === 'reminder-repeated') {
    const actions = [`Repeat ${Number(item.repeatCount) || 1}`, 'Customer comment sent'];
    if (item.nextDueAt) actions.push(`Next due ${formatDate(item.nextDueAt)}`);
    return actions.join(' · ');
  }
  if (item.type === 'auto-transitioned') {
    const actions = [];
    if (item.finalCommentSent) actions.push('Final customer comment sent');
    actions.push(`Status changed → ${item.destinationStatusName || 'final status'}`);
    if (item.resolutionName) actions.push(`Resolution → ${item.resolutionName}`);
    return actions.join(' · ');
  }
  return '';
}

function rowForActivity(item) {
  if (item.type === 'rule-check') return { ...item, filters: item.filtersMatched ? 'Matched' : 'Not matched', actionText: item.action || 'None', tone: item.filtersMatched ? 'matched' : 'neutral' };
  if (item.type === 'reminder-completed') return { ...item, filters: 'Matched', actionText: actionSummary(item), tone: 'action' };
  if (item.type === 'auto-transitioned') return { ...item, filters: 'Matched', actionText: actionSummary(item), tone: 'action' };
  if (item.type === 'reminder-repeated') return { ...item, filters: 'Matched', actionText: actionSummary(item), tone: 'action' };
  if (item.type === 'cycle-started') return { ...item, filters: 'Matched', actionText: `Follow-up started${item.source ? ` (${item.source})` : ''}${item.nextDueAt ? ` — first due ${formatDate(item.nextDueAt)}` : ''}`, tone: 'neutral' };
  if (item.type === 'cycle-cancelled') return { ...item, filters: item.filtersMatched === false ? 'Not matched' : '—', actionText: `Follow-up cancelled${item.reason ? ` — ${item.reason}` : ''}`, tone: 'neutral' };
  if (item.type === 'processing-error') {
    const detail = item.message || 'Processing failed';
    const context = [
      item.currentStatusName && `From: ${item.currentStatusName}`,
      item.destinationStatusName && `To: ${item.destinationStatusName}`,
      item.missingRequiredFields?.length && `Missing: ${item.missingRequiredFields.join(', ')}`,
      item.httpStatus && `Jira HTTP ${item.httpStatus}`
    ].filter(Boolean).join(' · ');
    return { ...item, filters: '—', actionText: context ? `${detail} — ${context}` : detail, tone: 'error' };
  }
  return null;
}

function actionKind(item) {
  const text = String(item.actionText ?? '').toLowerCase();
  if (item.type === 'processing-error') return 'error';
  if (item.type === 'reminder-completed' || item.type === 'reminder-repeated' || item.type === 'auto-transitioned') {
    if (text.includes('comment sent')) return 'comment';
    if (text.includes('status changed')) return 'status';
    return 'action';
  }
  if (item.type === 'cycle-cancelled' || item.type === 'cycle-started') return 'lifecycle';
  if (item.type === 'rule-check') {
    if (text.includes('follow-up started') || text.includes('follow-up cancelled')) return 'lifecycle';
    return 'check';
  }
  return 'other';
}

function isConcreteAction(item) {
  if (item.tone === 'action') return true;
  if (item.type === 'cycle-cancelled' || item.type === 'cycle-started') return true;
  if (item.type === 'rule-check') return Boolean(item.action && item.action !== 'None' && !item.action.startsWith('None -'));
  return false;
}

function ErrorDetails({ item }) {
  const details = [
    ['Reason', item.message || 'Jira rejected the follow-up action.'],
    ['Current status', item.currentStatusName],
    ['Target status', item.destinationStatusName],
    ['Failure stage', item.failureStage],
    ['Transition', [item.transitionName, item.transitionId && `ID ${item.transitionId}`].filter(Boolean).join(' · ')],
    ['Missing required fields', item.missingRequiredFields?.join(', ')],
    ['Available destinations', item.availableDestinations?.join(', ')],
    ['Jira response', item.httpStatus && `HTTP ${item.httpStatus}`],
    ['Configured field IDs', item.configuredFieldIds?.join(', ')]
  ].filter(([, value]) => value);

  return <details style={{ minWidth: 360 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#ae2a19' }}>
      {item.message && item.message !== 'Processing failed' ? item.message : `Transition failed → ${item.destinationStatusName || 'final status'}`} — view details
    </summary>
    <div style={{ marginTop: 8, padding: 10, border: '1px solid #f1c6c0', borderRadius: 6, background: '#fff7f5' }}>
      {details.map(([label, value]) => <div key={label} style={{ marginBottom: 5 }}><strong>{label}:</strong> {value}</div>)}
    </div>
  </details>;
}

function TicketLink({ issueKey }) {
  if (!issueKey) return <>—</>;
  return <button type="button" onClick={() => router.open(`/browse/${issueKey}`)} title={`Open ${issueKey} in Jira`} style={{ border: 0, background: 'transparent', padding: 0, color: '#0c66e4', fontWeight: 750, cursor: 'pointer' }}>{issueKey}</button>;
}

export default function ActivityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('actions');
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true); setError('');
    try { setData(await invoke('getProjectActivity')); }
    catch (err) { setError(err?.message || String(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const allRows = useMemo(() => (data?.activity ?? []).map(rowForActivity).filter(Boolean), [data]);

  const counts = useMemo(() => ({
    actions: allRows.filter(isConcreteAction).length,
    comments: allRows.filter((item) => String(item.actionText ?? '').toLowerCase().includes('comment sent')).length,
    status: allRows.filter((item) => String(item.actionText ?? '').toLowerCase().includes('status changed')).length,
    lifecycle: allRows.filter((item) => actionKind(item) === 'lifecycle').length,
    checks: allRows.filter((item) => item.type === 'rule-check').length,
    errors: allRows.filter((item) => item.type === 'processing-error').length
  }), [allRows]);

  const activity = useMemo(() => {
    let rows = [...allRows];
    if (filter === 'actions') rows = rows.filter(isConcreteAction);
    if (filter === 'comments') rows = rows.filter((item) => String(item.actionText ?? '').toLowerCase().includes('comment sent'));
    if (filter === 'status') rows = rows.filter((item) => String(item.actionText ?? '').toLowerCase().includes('status changed'));
    if (filter === 'lifecycle') rows = rows.filter((item) => actionKind(item) === 'lifecycle');
    if (filter === 'checks') rows = rows.filter((item) => item.type === 'rule-check');
    if (filter === 'errors') rows = rows.filter((item) => item.type === 'processing-error');
    const needle = query.trim().toLowerCase();
    if (needle) rows = rows.filter((item) => [item.issueKey, item.ruleName, item.ruleId, item.actionText, item.filters].some((value) => String(value ?? '').toLowerCase().includes(needle)));
    return rows;
  }, [allRows, filter, query]);

  if (loading && !data) return <section className="card"><h2>Run history</h2><div className="empty">Loading follow-up activity…</div></section>;
  if (error && !data) return <section className="card"><h2>Run history</h2><div className="notice">{error}</div></section>;

  const summary = data?.summary ?? {};
  const scheduler = data?.scheduler;
  const schedulerHealthy = scheduler?.status === 'success';

  const filterOptions = [
    ['actions', `Actions (${counts.actions})`],
    ['comments', `Comments (${counts.comments})`],
    ['status', `Status changes (${counts.status})`],
    ['lifecycle', `Started / cancelled (${counts.lifecycle})`],
    ['checks', `Checks (${counts.checks})`],
    ['errors', `Errors (${counts.errors})`],
    ['all', 'All activity']
  ];

  return <>
    <section className="activity-stats">
      <div className="stat-card"><span>Last scheduler run</span><strong>{formatDate(scheduler?.completedAt)}</strong><small className={schedulerHealthy ? 'status-ok' : scheduler ? 'status-warn' : ''}>{scheduler ? (schedulerHealthy ? 'Healthy' : 'Completed with errors') : 'Waiting for first recorded run'}</small></div>
      <div className="stat-card"><span>Active follow-ups</span><strong>{summary.activeFollowUps ?? 0}</strong><small>Currently being tracked</small></div>
      <div className="stat-card"><span>Reminders today</span><strong>{summary.remindersToday ?? 0}</strong><small>Reminder stages completed</small></div>
      <div className="stat-card"><span>Auto-closes today</span><strong>{summary.autoClosesToday ?? 0}</strong><small>Final transitions completed</small></div>
      <div className="stat-card"><span>Failures today</span><strong>{summary.failuresToday ?? 0}</strong><small className={(summary.failuresToday ?? 0) > 0 ? 'status-warn' : 'status-ok'}>{(summary.failuresToday ?? 0) > 0 ? 'Needs attention' : 'No failures recorded'}</small></div>
    </section>

    {scheduler && <section className="card scheduler-card"><div><h2>Scheduler health</h2><p className="muted">Heartbeat from the scheduled check of active follow-ups and eligible backlog tickets.</p></div><div className="scheduler-metrics"><span><strong>{scheduler.activeCyclesSeen ?? 0}</strong> cycles seen</span><span><strong>{scheduler.processed ?? 0}</strong> processed</span><span><strong>{scheduler.actions ?? 0}</strong> actions</span><span><strong>{scheduler.failures ?? 0}</strong> failures</span></div></section>}

    <section className="card">
      <div className="section-head"><div><h2>Run history</h2><p className="muted">Actions are shown first so you can quickly verify customer comments, status changes and follow-up lifecycle events. Use Checks when you need the detailed rule evaluation trail.</p></div><button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, margin: '16px 0', flexWrap: 'wrap' }}><div className="activity-filters" style={{ margin: 0 }}>{filterOptions.map(([value,label]) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find ticket, rule or action…" aria-label="Find ticket, rule or action" style={{ width: 300, maxWidth: '100%' }} /></div>
      {error && <div className="notice">{error}</div>}
      {activity.length === 0 ? <div className="empty">No matching activity has been recorded yet.</div> : <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Date / time</th><th>Ticket</th><th>Rule</th><th>Result</th><th>Action taken</th></tr></thead><tbody>{activity.map((item,index) => <tr key={`${item.timestamp}-${item.issueId}-${item.type}-${index}`}><td>{formatDate(item.timestamp)}</td><td><TicketLink issueKey={item.issueKey || item.issueId} /></td><td>{item.ruleName || item.ruleId || '—'}</td><td><span className={`result-pill ${item.filters === 'Matched' ? 'result-success' : ''}`}>{item.filters}</span></td><td>{item.tone === 'error' ? <ErrorDetails item={item} /> : <strong style={isConcreteAction(item) ? { fontWeight: 700 } : { fontWeight: 500 }}>{item.actionText}</strong>}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="card"><h2>Active follow-ups</h2>{(data?.activeCycles ?? []).length === 0 ? <div className="empty">No active follow-up cycles in this project.</div> : <div className="rules">{data.activeCycles.map((cycle) => <div className="rule" key={cycle.issueId}><div><div className="rule-title"><TicketLink issueKey={cycle.issueKey} /></div><div className="muted">{cycle.ruleName} · started {formatDate(cycle.startedAt)}{cycle.paused ? ' · paused' : ''}</div></div>{cycle.lastError && <span className="result-pill result-error">Last run failed</span>}</div>)}</div>}</section>
  </>;
}
