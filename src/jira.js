import api, { route } from '@forge/api';

const MAX_RETRIES = 3;
// Keep total waiting well inside the 55s trigger timeout.
const MAX_RETRY_DELAY_MS = 10 * 1000;

export function retryDelayMs(response, attempt) {
  const header = response?.headers?.get?.('Retry-After');
  if (header != null && header !== '') {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_DELAY_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
  }
  // No usable Retry-After: exponential backoff with jitter (1s, 2s, 4s ...).
  return Math.min(1000 * 2 ** attempt + Math.floor(Math.random() * 250), MAX_RETRY_DELAY_MS);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries Jira rate limiting (429), honouring Retry-After. A 429 means the
// request was not processed, so resending (including POSTs) cannot duplicate
// customer comments. Other failures are left to the caller's retry scheduling.
export async function withRateLimitRetry(send, { wait = sleep, maxRetries = MAX_RETRIES } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await send();
    if (response?.status !== 429 || attempt >= maxRetries) return response;
    await wait(retryDelayMs(response, attempt));
  }
}

function requestJiraAsApp(path, options) {
  return withRateLimitRetry(() => api.asApp().requestJira(path, options));
}

async function jsonOrThrow(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function getIssue(issueKey) {
  const response = await requestJiraAsApp(route`/rest/api/3/issue/${issueKey}?expand=names`);
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

    const response = await requestJiraAsApp(route`/rest/api/3/search/jql`, {
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
    const response = await requestJiraAsApp(
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
  const response = await requestJiraAsApp(route`/rest/servicedeskapi/request/${issueKey}/comment/${commentId}`);
  return jsonOrThrow(response, `Get JSM comment ${commentId} on ${issueKey}`);
}

export async function getRequestParticipants(issueKey) {
  const response = await requestJiraAsApp(route`/rest/servicedeskapi/request/${issueKey}/participant?limit=100`);
  const data = await jsonOrThrow(response, `Get request participants for ${issueKey}`);
  return data?.values ?? [];
}

export async function addRequestParticipants(issueKey, accountIds = []) {
  const uniqueIds = [...new Set((accountIds ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return null;
  const response = await requestJiraAsApp(route`/rest/servicedeskapi/request/${issueKey}/participant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountIds: uniqueIds })
  });
  return jsonOrThrow(response, `Add request participants to ${issueKey}`);
}

export async function addPublicCustomerComment(issueKey, body) {
  const response = await requestJiraAsApp(route`/rest/servicedeskapi/request/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, public: true })
  });
  return jsonOrThrow(response, `Add public comment to ${issueKey}`);
}

export async function getTransitions(issueKey, includeFields = false) {
  const response = includeFields
    ? await requestJiraAsApp(route`/rest/api/3/issue/${issueKey}/transitions?expand=transitions.fields`)
    : await requestJiraAsApp(route`/rest/api/3/issue/${issueKey}/transitions`);
  const data = await jsonOrThrow(response, `Get transitions for ${issueKey}`);
  return data?.transitions ?? [];
}

function isBlankExistingField(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if (Object.keys(value).length === 0) return true;
    if ('value' in value) return value.value == null || value.value === '';
    if ('name' in value) return value.name == null || value.name === '';
  }
  return false;
}

export async function transitionToStatus(issueKey, destinationStatusName, fields = {}, existingFields = {}) {
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
    .filter(([fieldId, metadata]) => metadata?.required && !metadata?.hasDefaultValue && cleanFields[fieldId] == null && isBlankExistingField(existingFields?.[fieldId]))
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

  const response = await requestJiraAsApp(route`/rest/api/3/issue/${issueKey}/transitions`, {
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
