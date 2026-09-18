import api, { route } from '@forge/api';

async function jsonOrThrow(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function getIssue(issueKey) {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?expand=names`);
  return jsonOrThrow(response, `Get issue ${issueKey}`);
}

export async function searchIssues(jql, fields = ['project', 'status']) {
  const results = [];
  let nextPageToken = null;

  do {
    const body = {
      jql,
      maxResults: 100,
      fields: [...new Set(fields.filter(Boolean))]
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const response = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await jsonOrThrow(response, 'Search Jira issues');
    results.push(...(data?.issues ?? []));
    nextPageToken = data?.nextPageToken ?? null;
  } while (nextPageToken);

  return results;
}

export function latestStatusEnteredAt(histories, statusName) {
  const target = String(statusName ?? '').toLowerCase();
  let latest = null;

  for (const history of histories ?? []) {
    const entered = (history?.items ?? []).some((item) =>
      String(item?.field ?? '').toLowerCase() === 'status' &&
      String(item?.toString ?? '').toLowerCase() === target
    );
    if (!entered || !history?.created) continue;
    if (!latest || new Date(history.created).getTime() > new Date(latest).getTime()) {
      latest = history.created;
    }
  }

  return latest;
}

export async function getStatusEnteredAt(issueKey, statusName) {
  const histories = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const response = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/changelog?startAt=${startAt}&maxResults=${maxResults}`
    );
    const data = await jsonOrThrow(response, `Get changelog for ${issueKey}`);
    histories.push(...(data?.values ?? []));
    const total = Number(data?.total ?? histories.length);
    startAt += Number(data?.maxResults ?? maxResults);
    if (startAt >= total || !(data?.values ?? []).length) break;
  }

  return latestStatusEnteredAt(histories, statusName);
}

export async function getRequestComment(issueKey, commentId) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment/${commentId}`);
  return jsonOrThrow(response, `Get JSM comment ${commentId} on ${issueKey}`);
}

export async function getRequestParticipants(issueKey) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/participant?limit=100`);
  const data = await jsonOrThrow(response, `Get request participants for ${issueKey}`);
  return data?.values ?? [];
}

export async function addRequestParticipants(issueKey, accountIds = []) {
  const uniqueIds = [...new Set((accountIds ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return null;
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/participant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountIds: uniqueIds })
  });
  return jsonOrThrow(response, `Add request participants to ${issueKey}`);
}

export async function addPublicCustomerComment(issueKey, body) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, public: true })
  });
  return jsonOrThrow(response, `Add public comment to ${issueKey}`);
}

export async function getTransitions(issueKey, includeFields = false) {
  const response = includeFields
    ? await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`)
    : await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`);
  const data = await jsonOrThrow(response, `Get transitions for ${issueKey}`);
  return data?.transitions ?? [];
}

export async function transitionToStatus(issueKey, destinationStatusName, fields = {}) {
  const transitions = await getTransitions(issueKey, true);
  const transition = transitions.find(
    (item) => String(item?.to?.name ?? '').toLowerCase() === String(destinationStatusName).toLowerCase()
  );

  if (!transition) {
    const available = transitions.map((item) => item?.to?.name).filter(Boolean).join(', ');
    const error = new Error(`No available transition to "${destinationStatusName}" for ${issueKey}. Available destinations: ${available || 'none'}`);
    error.transitionDiagnostics = { stage: 'transition-selection', destinationStatusName, availableDestinations: transitions.map((item) => item?.to?.name).filter(Boolean) };
    throw error;
  }

  const cleanFields = Object.fromEntries(
    Object.entries(fields ?? {}).filter(([, value]) => value != null && value !== '')
  );

  const missingRequired = Object.entries(transition.fields ?? {})
    .filter(([fieldId, metadata]) => metadata?.required && !metadata?.hasDefaultValue && cleanFields[fieldId] == null)
    .map(([fieldId, metadata]) => metadata?.name || fieldId);

  if (missingRequired.length) {
    const error = new Error(
      `Transition to "${destinationStatusName}" for ${issueKey} requires additional field${missingRequired.length === 1 ? '' : 's'}: ${missingRequired.join(', ')}`
    );
    error.transitionDiagnostics = { stage: 'required-fields', destinationStatusName, transitionId: transition.id, transitionName: transition.name, missingRequiredFields: missingRequired };
    throw error;
  }

  const payload = { transition: { id: transition.id } };
  if (Object.keys(cleanFields).length) payload.fields = cleanFields;

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Transition ${issueKey} to "${destinationStatusName}" failed (${response.status}): ${body}`);
    error.transitionDiagnostics = {
      stage: 'jira-transition-request',
      destinationStatusName,
      transitionId: transition.id,
      transitionName: transition.name,
      httpStatus: response.status,
      configuredFieldIds: Object.keys(cleanFields)
    };
    throw error;
  }
  return transition;
}
