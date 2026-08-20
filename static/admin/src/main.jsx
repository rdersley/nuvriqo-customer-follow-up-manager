import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import './styles.css';

const blankCondition = () => ({ fieldId: '', operator: 'equals', value: '' });
const blankReminder = (afterDays = 2) => ({
  afterDays,
  message: 'Hi {{customer.firstName}}, we are waiting for your response regarding {{issue.key}}.',
  destinationStatusName: '',
  participantAccountIds: []
});

const emptyRule = (projectKey = '') => ({
  id: `rule-${Date.now()}`,
  name: '',
  priority: 100,
  enabled: true,
  projectKey,
  waitingStatusName: '',
  timingUnit: 'days',
  conditions: [blankCondition()],
  reminders: [blankReminder(2)],
  finalAction: { afterDays: 7, destinationStatusName: '', resolutionId: '' }
});

function normaliseRule(rule) {
  const next = structuredClone(rule);
  next.timingUnit ??= 'days';
  next.conditions = Array.isArray(next.conditions)
    ? next.conditions
    : next.condition?.fieldId
      ? [next.condition]
      : [blankCondition()];
  next.reminders = (next.reminders ?? []).map((reminder) => ({
    ...reminder,
    destinationStatusName: reminder.destinationStatusName ?? '',
    participantAccountIds: reminder.participantAccountIds ?? []
  }));
  next.finalAction = { resolutionId: '', ...(next.finalAction ?? {}) };
  return next;
}

function ConditionRow({ condition, index, fields, onUpdate, onRemove, canRemove }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const field = fields.find((item) => item.id === condition.fieldId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!field?.name) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const result = await invoke('getFieldSuggestions', { fieldName: field.name });
        if (!cancelled) setSuggestions(result?.values ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [field?.id]);

  return <div className="condition-row">
    <label>Ticket field
      <select value={condition.fieldId} onChange={(e) => onUpdate(index, 'fieldId', e.target.value, true)}>
        <option value="">Choose field…</option>
        {fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label>Comparison
      <select value={condition.operator ?? 'equals'} onChange={(e) => onUpdate(index, 'operator', e.target.value)}>
        <option value="equals">Equals</option>
        <option value="notEquals">Does not equal</option>
      </select>
    </label>
    <label>Value
      <input
        list={`field-values-${index}`}
        value={condition.value ?? ''}
        onChange={(e) => onUpdate(index, 'value', e.target.value)}
        placeholder={loading ? 'Loading Jira values…' : 'Choose or type value'}
      />
      <datalist id={`field-values-${index}`}>{suggestions.map((item) => <option key={item.value} value={item.value}>{item.displayName}</option>)}</datalist>
      <span className="hint-inline">{suggestions.length ? `${suggestions.length} Jira values available.` : 'Free text remains available for fields without suggestions.'}</span>
    </label>
    {canRemove && <button className="icon-danger condition-remove" onClick={() => onRemove(index)} title="Remove filter">×</button>}
  </div>;
}

function App() {
  const [setup, setSetup] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

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
  const resolutions = setup?.resolutions ?? [];

  function update(path, value) {
    setEditing((current) => {
      const next = structuredClone(current);
      let target = next;
      for (let i = 0; i < path.length - 1; i += 1) target = target[path[i]];
      target[path[path.length - 1]] = value;
      return next;
    });
  }

  function updateCondition(index, key, value, resetValue = false) {
    setEditing((current) => {
      const next = structuredClone(current);
      next.conditions[index][key] = value;
      if (resetValue) next.conditions[index].value = '';
      return next;
    });
  }

  function addCondition() {
    setEditing((current) => ({ ...current, conditions: [...current.conditions, blankCondition()] }));
  }

  function removeCondition(index) {
    setEditing((current) => ({ ...current, conditions: current.conditions.filter((_, i) => i !== index) }));
  }

  function addReminder() {
    const last = editing.reminders.at(-1)?.afterDays ?? 0;
    setEditing({ ...editing, reminders: [...editing.reminders, blankReminder(Number(last) + 2)] });
  }

  function removeReminder(index) {
    setEditing({ ...editing, reminders: editing.reminders.filter((_, i) => i !== index) });
  }

  function updateParticipantIds(index, text) {
    const ids = text.split(',').map((item) => item.trim()).filter(Boolean);
    update(['reminders', index, 'participantAccountIds'], ids);
  }

  async function save() {
    setBusy(true); setMessage('');
    try {
      const clean = structuredClone(editing);
      clean.conditions = clean.conditions.filter((condition) => condition.fieldId);
      delete clean.condition;
      const result = await invoke('saveRule', { rule: clean });
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
        <div className="rules">{setup.rules.map((rule) => {
          const conditions = Array.isArray(rule.conditions) ? rule.conditions : rule.condition?.fieldId ? [rule.condition] : [];
          const conditionText = conditions.length
            ? conditions.map((condition) => `${fieldOptions.find((field) => field.id === condition.fieldId)?.name || condition.fieldId} ${condition.operator === 'notEquals' ? '≠' : '='} ${condition.value}`).join(' AND ')
            : 'All matching tickets';
          return <div className="rule" key={rule.id}>
            <div><div className="rule-title">{rule.name}</div><div className="muted">{conditionText} · {rule.reminders.length} reminder{rule.reminders.length === 1 ? '' : 's'} · {rule.timingUnit ?? 'days'} · → {rule.finalAction.destinationStatusName}</div></div>
            <div className="actions"><button onClick={() => setEditing(normaliseRule(rule))}>Edit</button><button className="danger" onClick={() => remove(rule.id)}>Delete</button></div>
          </div>;
        })}</div>}
    </section>}

    {editing && <section className="card editor">
      <div className="section-head"><h2>{setup.rules.some((rule) => rule.id === editing.id) ? 'Edit rule' : 'New rule'}</h2><label className="toggle"><input type="checkbox" checked={editing.enabled} onChange={(e) => update(['enabled'], e.target.checked)} /> Enabled</label></div>

      <div className="grid two">
        <label>Rule name<input value={editing.name} onChange={(e) => update(['name'], e.target.value)} placeholder="Ryanair hardware follow-up" /></label>
        <label>Priority<input type="number" value={editing.priority ?? 100} onChange={(e) => update(['priority'], Number(e.target.value))} /></label>
      </div>

      <h3>Start status</h3>
      <div className="grid two">
        <label>Waiting status<select value={editing.waitingStatusName} onChange={(e) => update(['waitingStatusName'], e.target.value)}><option value="">Choose status…</option>{statuses.map((status) => <option key={status.id} value={status.name}>{status.name}</option>)}</select></label>
        <label>Time unit<select value={unit} onChange={(e) => update(['timingUnit'], e.target.value)}><option value="days">Days</option><option value="hours">Hours</option></select></label>
      </div>

      <div className="section-head"><h3>Rule filters</h3><button onClick={addCondition}>+ Add filter</button></div>
      <p className="hint">All filters must match. Example: <strong>Client = Ryanair</strong> AND <strong>Ticket Type = Hardware</strong>.</p>
      <div className="conditions">{editing.conditions.map((condition, index) => <ConditionRow key={index} condition={condition} index={index} fields={fieldOptions} onUpdate={updateCondition} onRemove={removeCondition} canRemove={editing.conditions.length > 1} />)}</div>

      <div className="section-head"><h3>Customer reminders</h3><button onClick={addReminder}>+ Add reminder</button></div>
      <div className="reminders">{editing.reminders.map((reminder, index) => <div className="reminder expanded" key={index}>
        <div className="reminder-number">{index + 1}</div>
        <div className="reminder-main">
          <div className="grid two">
            <label>After {unitLabel}<input type="number" min="0" value={reminder.afterDays} onChange={(e) => update(['reminders', index, 'afterDays'], Number(e.target.value))} /></label>
            <label>Change status after reminder<select value={reminder.destinationStatusName ?? ''} onChange={(e) => update(['reminders', index, 'destinationStatusName'], e.target.value)}><option value="">No status change</option>{statuses.map((status) => <option key={status.id} value={status.name}>{status.name}</option>)}</select></label>
          </div>
          <label>Public customer message<textarea rows="3" value={reminder.message} onChange={(e) => update(['reminders', index, 'message'], e.target.value)} /></label>
          <label className="participant-field">Add request participant(s)
            <input value={(reminder.participantAccountIds ?? []).join(', ')} onChange={(e) => updateParticipantIds(index, e.target.value)} placeholder="Atlassian account ID(s), comma separated" />
            <span className="hint-inline">Participants are added before the public reminder comment. A searchable participant picker is the next UI refinement.</span>
          </label>
        </div>
        <button className="icon-danger" onClick={() => removeReminder(index)} title="Remove reminder">×</button>
      </div>)}</div>
      <p className="hint">Template variables: {'{{customer.firstName}}'}, {'{{customer.name}}'}, {'{{issue.key}}'}, {'{{issue.summary}}'}, {'{{daysWaiting}}'}, {'{{waitingAmount}}'}, {'{{waitingUnit}}'}</p>

      <h3>Final action</h3>
      <div className="grid two">
        <label>Auto-transition after {unitLabel}<input type="number" min="0" value={editing.finalAction.afterDays} onChange={(e) => update(['finalAction', 'afterDays'], Number(e.target.value))} /></label>
        <label>Destination status<select value={editing.finalAction.destinationStatusName} onChange={(e) => update(['finalAction', 'destinationStatusName'], e.target.value)}><option value="">Choose status…</option>{statuses.map((status) => <option key={status.id} value={status.name}>{status.name}</option>)}</select></label>
      </div>
      <div className="grid two">
        <label>Resolution<select value={editing.finalAction.resolutionId ?? ''} onChange={(e) => update(['finalAction', 'resolutionId'], e.target.value)}><option value="">Do not set Resolution</option>{resolutions.map((resolution) => <option key={resolution.id} value={resolution.id}>{resolution.name}</option>)}</select></label>
        <div className="hint-box">Use this when the destination workflow transition requires Jira's <strong>Resolution</strong> field. Nuvriqo sends it as part of the transition.</div>
      </div>
      <p className="hint">At runtime Nuvriqo finds an available workflow transition whose destination matches the selected status and submits configured transition fields with it.</p>

      <div className="footer-actions"><button onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rule'}</button></div>
    </section>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
