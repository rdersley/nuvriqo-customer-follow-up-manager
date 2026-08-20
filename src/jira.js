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
    throw new Error(`No available transition to "${destinationStatusName}" for ${issueKey}. Available destinations: ${available || 'none'}`);
  }

  const payload = { transition: { id: transition.id } };
  const cleanFields = Object.fromEntries(Object.entries(fields ?? {}).filter(([, value]) => value != null && value !== ''));
  if (Object.keys(cleanFields).length) payload.fields = cleanFields;

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await jsonOrThrow(response, `Transition ${issueKey} to ${destinationStatusName}`);
  return transition;
}
