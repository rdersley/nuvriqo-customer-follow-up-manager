import React, { useMemo } from 'react';

export default function OverviewPanel({ rules = [], onCreateRule, onOpenRules, onOpenHistory }) {
  const stats = useMemo(() => {
    const enabled = rules.filter((rule) => rule.enabled !== false);
    const reminderStages = rules.reduce((total, rule) => total + (rule.reminders?.length ?? 0), 0);
    const autoClose = rules.filter((rule) => rule.finalAction?.destinationStatusName).length;
    return {
      total: rules.length,
      enabled: enabled.length,
      reminderStages,
      autoClose
    };
  }, [rules]);

  const priorityRules = useMemo(() => [...rules]
    .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100))
    .slice(0, 5), [rules]);

  return <div className="overview-view">
    <div className="overview-stats">
      <div className="overview-stat"><span>Total rules</span><strong>{stats.total}</strong><small>Configured policies</small></div>
      <div className="overview-stat"><span>Enabled</span><strong>{stats.enabled}</strong><small>Currently active</small></div>
      <div className="overview-stat"><span>Reminder stages</span><strong>{stats.reminderStages}</strong><small>Across all rules</small></div>
      <div className="overview-stat"><span>Auto-close rules</span><strong>{stats.autoClose}</strong><small>With a final transition</small></div>
    </div>

    <div className="overview-grid">
      <section className="card overview-card">
        <div className="section-head">
          <div><h2>Priority rules</h2><p className="muted">The first policies Jira evaluates based on configured priority.</p></div>
          <button onClick={onOpenRules}>View all rules</button>
        </div>
        {priorityRules.length === 0 ? <div className="empty">No follow-up rules are configured yet.</div> :
          <div className="overview-rule-list">{priorityRules.map((rule) => <div className="overview-rule" key={rule.id}>
            <div>
              <strong>{rule.name || 'Untitled rule'}</strong>
              <span>{rule.reminders?.length ?? 0} reminder{(rule.reminders?.length ?? 0) === 1 ? '' : 's'} · final status {rule.finalAction?.destinationStatusName || 'not set'}</span>
            </div>
            <span className={rule.enabled === false ? 'overview-status is-off' : 'overview-status'}>{rule.enabled === false ? 'Disabled' : 'Enabled'}</span>
          </div>)}</div>}
      </section>

      <aside className="card overview-card quick-actions-card">
        <h2>Quick actions</h2>
        <p className="muted">Common administration tasks.</p>
        <button className="quick-action primary" onClick={onCreateRule}>+ Create follow-up rule</button>
        <button className="quick-action" onClick={onOpenRules}>Manage rules</button>
        <button className="quick-action" onClick={onOpenHistory}>View run history</button>
      </aside>
    </div>
  </div>;
}
