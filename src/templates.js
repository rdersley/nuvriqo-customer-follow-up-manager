export function renderTemplate(template, context) {
  return String(template ?? '').replace(/{{\s*([\w.]+)\s*}}/g, (_, path) => {
    const value = path.split('.').reduce((current, part) => current?.[part], context);
    return value == null ? '' : String(value);
  });
}

export function buildTemplateContext(issue, cycle, daysWaiting) {
  const displayName = issue?.fields?.reporter?.displayName ?? 'Customer';
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;
  return {
    customer: { name: displayName, firstName },
    issue: { key: issue.key, summary: issue?.fields?.summary ?? '' },
    daysWaiting
  };
}
