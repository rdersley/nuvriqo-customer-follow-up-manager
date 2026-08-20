import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import './styles.css';

const emptyRule = (projectKey = '') => ({
  id: `rule-${Date.now()}`,
  name: '',
  priority: 100,
  enabled: true,
  projectKey,
  waitingStatusName: '',
  timingUnit: 'days',
  condition: { fieldId: '', operator: 'equals', value: '' },
  reminders: [{ afterDays: 2, message: 'Hi {{customer.firstName}}, we are waiting for your response regarding {{issue.key}}.' }],
  finalAction: { afterDays: 7, destinationStatusName: '' }
});

function App() {
  const [setup, setSetup] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldSuggestions, setFieldSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const data = await invoke('getProjectSetup');
      setSetup(data);
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const fieldOptions = useMemo(() => setup?.fields ?? [], [setup]);
  const statuses = setup?.statuses ?? [];
  const selectedField = editing?.condition?.fieldId
    ? fieldOptions.find((field) => field.id === editing.condition.fieldId)
    : null;

  useEffect(() => {
    let cancelled = false;
    async function loadSuggestions() {
      if (!selectedField?.name) {
        setFieldSuggestions([]);
        return;
      }
      setLoadingSuggestions(true);
      try {
        const result = await invoke('getFieldSuggestions', { fieldName: selectedField.name });
        if (!cancelled) setFieldSuggestions(result?.values ?? []);
      } catch {
        if (!cancelled) setFieldSuggestions([]);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    }
    loadSuggestions();
    return () => { cancelled = true; };
  }, [selectedField?.id]);

  function update(path, value) {
    setEditing((current) => {
      const next = structuredClone(current);
      let target = next;
      for (let i = 0; i < path.length - 1; i += 1) target = target[path[i]];
      target[path[path.length - 1]] = value;
      return next;
    });
  }

  function changeField(fieldId) {
    setEditing((current) => ({
      ...current,
      condition: { ...current.condition, fieldId, value: '' }
    }));
    setFieldSuggestions([]);
  }

  function addReminder() {
    const last = editing.reminders.at(-1)?.afterDays ?? 0;
    setEditing({ ...editing, reminders: [...editing.reminders, { afterDays: Number(last) + 2, message: 'Hi {{customer.firstName}}, we are still waiting for your response regarding {{issue.key}}.' }] });
  }

  function removeReminder(index) {
    setEditing({ ...editing, reminders: editing.reminders.filter((_, i) => i !== index) });
  }

  async function save() {
    setBusy(true); setMessage('');
    try {
      const result = await invoke('saveRule', { rule: editing });
      if (!result.ok) {
        setMessage(result.errors.join(' • '));
        return;
      }
      setEditing(null);
      setMessage('Rule saved.');
      await load();
    } catch (error) {
      setMessage(error.message || String(error));
    } finally { setBusy(false); }
  }

  async function remove(ruleId) {
    if (!confirm('Delete this follow-up rule?')) return;
    setBusy(true);
    try {
      await invoke('deleteRule', { ruleId });
      setMessage('Rule deleted.');
      await load();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(false); }
  }

  if (!setup) return <main className="page"><h1>Nuvriqo Follow-Up Manager</h1><p>{busy ? 'Loading project configuration…' : message}</p></main>;

  const unit = editing?.timingUnit ?? 'days';
  const unitLabel = unit === 'hours' ? 'hours' : 'days';

  return <main className="page">
    <div className="header">
      <div><p className="eyebrow">Nuvriqo</p><h1>Customer Follow-Up Manager</h1><p>Configure follow-up and auto-close policies for <strong>{setup.projectKey}</strong>.</p></div>
      {!editing && <button className="primary" onClick={() => setEditing(emptyRule(setup.projectKey))}>Create rule</button>}
    </div>

    {message && <div className="notice">{message}</div>}

    {!editing && <section className="card">
      <h2>Follow-up rules</h2>
      {setup.rules.length === 0 ? <div className="empty">No rules yet. Create your first customer follow-up policy.</div> :
        <div className="rules">{setup.rules.map((rule) => <div className="rule" key={rule.id}>
          <div><div className="rule-title">{rule.name}</div><div className="muted">{rule.condition?.fieldId ? `${fieldOptions.find(f => f.id === rule.condition.fieldId)?.name || rule.condition.fieldId} = ${rule.condition.value}` : 'All matching tickets'} · {rule.reminders.length} reminder{rule.reminders.length === 1 ? '' : 's'} · {rule.timingUnit ?? 'days'} · → {rule.finalAction.destinationStatusName}</div></div>
          <div className="actions"><button onClick={() => setEditing({ timingUnit: 'days', ...structuredClone(rule) })}>Edit</button><button className="danger" onClick={() => remove(rule.id)}>Delete</button></div>
        </div>)}</div>}
    </section>}

    {editing && <section className="card editor">
      <div className="section-head"><h2>{setup.rules.some(r => r.id === editing.id) ? 'Edit rule' : 'New rule'}</h2><label className="toggle"><input type="checkbox" checked={editing.enabled} onChange={e => update(['enabled'], e.target.checked)} /> Enabled</label></div>

      <div className="grid two">
        <label>Rule name<input value={editing.name} onChange={e => update(['name'], e.target.value)} placeholder="Hardware follow-up" /></label>
        <label>Priority<input type="number" value={editing.priority ?? 100} onChange={e => update(['priority'], Number(e.target.value))} /></label>
      </div>

      <h3>Start condition</h3>
      <div className="grid two">
        <label>Waiting status<select value={editing.waitingStatusName} onChange={e => update(['waitingStatusName'], e.target.value)}><option value="">Choose status…</option>{statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
        <label>Ticket field<select value={editing.condition.fieldId} onChange={e => changeField(e.target.value)}><option value="">Any ticket</option>{fieldOptions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      </div>
      {editing.condition.fieldId && <div className="grid two">
        <label>Comparison<select value={editing.condition.operator} onChange={e => update(['condition','operator'], e.target.value)}><option value="equals">Equals</option><option value="notEquals">Does not equal</option></select></label>
        <label>Field value
          <input list="nuvriqo-field-values" value={editing.condition.value} onChange={e => update(['condition','value'], e.target.value)} placeholder={loadingSuggestions ? 'Loading values…' : 'Hardware'} />
          <datalist id="nuvriqo-field-values">{fieldSuggestions.map((item) => <option key={item.value} value={item.value}>{item.displayName}</option>)}</datalist>
          <span className="hint-inline">{loadingSuggestions ? 'Loading Jira values…' : fieldSuggestions.length ? `${fieldSuggestions.length} Jira value suggestions available.` : 'Enter the field value exactly as it appears in Jira.'}</span>
        </label>
      </div>}

      <h3>Timing</h3>
      <div className="grid two">
        <label>Time unit<select value={unit} onChange={e => update(['timingUnit'], e.target.value)}><option value="days">Days</option><option value="hours">Hours</option></select></label>
        <div className="hint-box">Use <strong>Hours</strong> for fast testing. Production rules can normally use days.</div>
      </div>

      <div className="section-head"><h3>Customer reminders</h3><button onClick={addReminder}>+ Add reminder</button></div>
      <div className="reminders">{editing.reminders.map((reminder, index) => <div className="reminder" key={index}>
        <div className="reminder-number">{index + 1}</div>
        <label>After {unitLabel}<input type="number" min="0" value={reminder.afterDays} onChange={e => update(['reminders', index, 'afterDays'], Number(e.target.value))} /></label>
        <label className="message-field">Public customer message<textarea rows="3" value={reminder.message} onChange={e => update(['reminders', index, 'message'], e.target.value)} /></label>
        <button className="icon-danger" onClick={() => removeReminder(index)} title="Remove reminder">×</button>
      </div>)}</div>
      <p className="hint">Template variables: {'{{customer.firstName}}'}, {'{{customer.name}}'}, {'{{issue.key}}'}, {'{{issue.summary}}'}, {'{{daysWaiting}}'}, {'{{waitingAmount}}'}, {'{{waitingUnit}}'}</p>

      <h3>Final action</h3>
      <div className="grid two">
        <label>Auto-transition after {unitLabel}<input type="number" min="0" value={editing.finalAction.afterDays} onChange={e => update(['finalAction','afterDays'], Number(e.target.value))} /></label>
        <label>Destination status<select value={editing.finalAction.destinationStatusName} onChange={e => update(['finalAction','destinationStatusName'], e.target.value)}><option value="">Choose status…</option>{statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
      </div>
      <p className="hint">At runtime Nuvriqo finds an available workflow transition whose destination matches this status.</p>

      <div className="footer-actions"><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rule'}</button></div>
    </section>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
