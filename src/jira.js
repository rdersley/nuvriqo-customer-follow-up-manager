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

export async function addPublicCustomerComment(issueKey, body) {
  const response = await api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, public: true })
  });
  return jsonOrThrow(response, `Add public comment to ${issueKey}`);
}

export async function getTransitions(issueKey) {
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`);
  const data = await jsonOrThrow(response, `Get transitions for ${issueKey}`);
  return data?.transitions ?? [];
}

export async function transitionToStatus(issueKey, destinationStatusName) {
  const transitions = await getTransitions(issueKey);
  const transition = transitions.find(
    (item) => String(item?.to?.name ?? '').toLowerCase() === String(destinationStatusName).toLowerCase()
  );

  if (!transition) {
    const available = transitions.map((item) => item?.to?.name).filter(Boolean).join(', ');
    throw new Error(`No available transition to "${destinationStatusName}" for ${issueKey}. Available destinations: ${available || 'none'}`);
  }

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: transition.id } })
  });
  await jsonOrThrow(response, `Transition ${issueKey} to ${destinationStatusName}`);
  return transition;
}
