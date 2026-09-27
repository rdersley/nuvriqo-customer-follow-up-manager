import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view as forgeView } from '@forge/bridge';
import '@nuvriqo/ui/css';
import { enableTheme } from '@nuvriqo/ui/theme';
import './styles.css';

enableTheme(forgeView);

function fmt(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function App() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setBusy(true);
    try {
      setData(await invoke('getIssuePanel'));
    } catch (error) {
      setMessage(error.message || String(error));
    } finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  async function run(action) {
    setBusy(true); setMessage('');
    try {
      const result = await invoke(action);
      if (result && result.ok === false) setMessage(result.error || 'Action could not be completed.');
      await load();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(false); }
  }

  const nextAction = useMemo(() => {
    if (!data?.cycle || !data?.rule) return null;
    const done = new Set(data.cycle.completedReminderIndexes ?? []);
    const nextIndex = data.rule.reminders.findIndex((_, index) => !done.has(index));
    const unit = data.rule.timingUnit === 'hours' ? 'hour(s)' : 'day(s)';
    if (nextIndex >= 0) return `Reminder ${nextIndex + 1} after ${data.rule.reminders[nextIndex].afterDays} ${unit}`;
    return `Auto-transition to ${data.rule.finalAction.destinationStatusName} after ${data.rule.finalAction.afterDays} ${unit}`;
  }, [data]);

  if (!data) return <main className="panel"><p>{busy ? 'Loading Nuvriqo follow-up…' : message}</p></main>;

  const cycle = data.cycle;
  const canWrite = data.licensed !== false;

  return <main className="panel">
    {data.licensed === false && <div className="notice">Nuvriqo is read-only because this installation does not currently have an active Marketplace license.</div>}
    {message && <div className="notice">{message}</div>}

    {!cycle ? <div className="empty">
      <div className="status-dot off" />
      <div><h3>No active follow-up</h3><p>This ticket is not currently running a Nuvriqo follow-up cycle.</p></div>
      <button disabled={busy || !canWrite} onClick={() => run('restartCycle')}>Start if eligible</button>
    </div> : <>
      <div className="topline">
        <div><span className={`pill ${cycle.paused ? 'paused' : 'active'}`}>{cycle.paused ? 'Paused' : 'Active'}</span><h3>{data.rule?.name || cycle.ruleId}</h3></div>
        <div className="buttons">
          {cycle.paused ? <button onClick={() => run('resumeCycle')} disabled={busy || !canWrite}>Resume</button> : <button onClick={() => run('pauseCycle')} disabled={busy || !canWrite}>Pause</button>}
          <button onClick={() => run('restartCycle')} disabled={busy || !canWrite}>Restart</button>
          <button className="danger" onClick={() => run('cancelCycle')} disabled={busy || !canWrite}>Cancel</button>
        </div>
      </div>

      {cycle.lastError && <div className="error-box">
        <strong>Follow-up action needs attention</strong>
        <span>{cycle.lastError.message}</span>
        <small>{fmt(cycle.lastError.occurredAt)}</small>
      </div>}

      <div className="metrics">
        <div><span>Started</span><strong>{fmt(cycle.startedAt)}</strong></div>
        <div><span>Reminders completed</span><strong>{cycle.completedReminderIndexes?.length ?? 0} / {data.rule?.reminders?.length ?? 0}</strong></div>
        <div><span>Next action</span><strong>{cycle.paused ? 'Paused' : nextAction}</strong></div>
        <div><span>Final status</span><strong>{data.rule?.finalAction?.destinationStatusName ?? '—'}</strong></div>
      </div>
    </>}

    <div className="audit">
      <h4>Recent activity</h4>
      {data.audit.length === 0 ? <p className="muted">No Nuvriqo activity recorded yet.</p> : data.audit.map((item, index) => <div className="audit-row" key={`${item.timestamp}-${index}`}>
        <div className="audit-time">{fmt(item.timestamp)}</div>
        <div><strong>{item.type.replaceAll('-', ' ')}</strong>{item.reason && <span> — {item.reason}</span>}{item.destinationStatusName && <span> → {item.destinationStatusName}</span>}{item.message && item.type === 'processing-error' && <span> — {item.message}</span>}</div>
      </div>)}
    </div>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
