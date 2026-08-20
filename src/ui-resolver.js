import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { getIssue } from './jira.js';
import { reconcileIssue } from './followups.js';
import {
  appendAudit,
  deleteCycle,
  deleteRule,
  getAudit,
  getCycle,
  getRules,
  saveCycle,
  saveRule
} from './storage.js';
import { validateRule } from './rules.js';

const resolver = new Resolver();

async function readJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
  return response.json();
}
function projectKeyFromContext(context) { return context?.extension?.project?.key ?? context?.project?.key ?? null; }
function issueKeyFromContext(context) { return context?.extension?.issue?.key ?? context?.issue?.key ?? null; }
function optionValue(option) {
  if (option == null) return null;
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') return { value: String(option), displayName: String(option) };
  const value = option.value ?? option.name ?? option.displayName ?? option.key ?? option.id;
  if (value == null) return null;
  return { value: String(value), displayName: String(option.displayName ?? option.name ?? option.value ?? value) };
}
function flattenActualValues(value, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) { for (const item of value) flattenActualValues(item, output); return output; }
  if (typeof value === 'object') {
    const direct = optionValue(value); if (direct) output.push(direct);
    if (value.child) flattenActualValues(value.child, output);
    if (value.children) flattenActualValues(value.children, output);
    return output;
  }
  const direct = optionValue(value); if (direct) output.push(direct); return output;
}
function uniqueOptions(options) {
  const map = new Map();
  for (const option of options) {
    const normalised = optionValue(option); if (!normalised?.value) continue;
    const key = normalised.value.toLowerCase(); if (!map.has(key)) map.set(key, normalised);
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
async function getProjectFieldAllowedValues(projectKey, fieldId) {
  const diagnostics = { issueTypesStatus: null, issueTypes: 0, fieldPages: 0, fieldFound: 0, allowedValues: 0 };
  const response = await api.asApp().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=100`);
  diagnostics.issueTypesStatus = response.status;
  if (!response.ok) return { values: [], diagnostics };
  const data = await response.json(); const issueTypes = data?.issueTypes ?? data?.values ?? []; diagnostics.issueTypes = issueTypes.length;
  const collected = [];
  for (const issueType of issueTypes) {
    let startAt = 0; let total = 1;
    while (startAt < total) {
      const fieldsResponse = await api.asApp().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${issueType.id}?startAt=${startAt}&maxResults=50`);
      diagnostics.fieldPages += 1; if (!fieldsResponse.ok) break;
      const fieldsData = await fieldsResponse.json(); const fields = fieldsData?.fields ?? fieldsData?.values ?? [];
      const field = fields.find((item) => item.fieldId === fieldId || item.key === fieldId || item.id === fieldId);
      if (field) diagnostics.fieldFound += 1;
      if (field?.allowedValues?.length) { collected.push(...field.allowedValues); diagnostics.allowedValues += field.allowedValues.length; }
      const pageSize = Number(fieldsData?.maxResults ?? fields.length ?? 50); total = Number(fieldsData?.total ?? fields.length ?? 0); startAt += Math.max(pageSize, 1); if (!fields.length) break;
    }
  }
  return { values: uniqueOptions(collected), diagnostics };
}
function escapeJqlString(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
async function searchObservedValues(projectKey, fieldId, fieldName) {
  const diagnostics = { status: null, issues: 0, extracted: 0, error: null };
  if (!projectKey || !fieldId) return { values: [], diagnostics };
  const clauses = [`project = "${escapeJqlString(projectKey)}"`];
  if (fieldName) clauses.push(`"${escapeJqlString(fieldName)}" is not EMPTY`);
  const jql = clauses.join(' AND ');
  const body = JSON.stringify({ jql, maxResults: 100, fields: [fieldId] });
  let response = await api.asApp().requestJira(route`/rest/api/3/search/jql`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body });
  diagnostics.status = response.status;
  if (!response.ok) {
    response = await api.asApp().requestJira(route`/rest/api/3/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body });
    diagnostics.status = response.status;
  }
  if (!response.ok) { diagnostics.error = (await response.text()).slice(0, 300); return { values: [], diagnostics }; }
  const data = await response.json(); const collected = []; diagnostics.issues = (data?.issues ?? []).length;
  for (const issue of data?.issues ?? []) flattenActualValues(issue?.fields?.[fieldId], collected);
  diagnostics.extracted = collected.length;
  return { values: uniqueOptions(collected), diagnostics };
}
async function getJqlSuggestions(fieldName, fieldValue = '') {
  const diagnostics = { status: null, results: 0 };
  if (!fieldName) return { values: [], diagnostics };
  const response = fieldValue
    ? await api.asApp().requestJira(route`/rest/api/3/jql/autocompletedata/suggestions?fieldName=${fieldName}&fieldValue=${fieldValue}`)
    : await api.asApp().requestJira(route`/rest/api/3/jql/autocompletedata/suggestions?fieldName=${fieldName}`);
  diagnostics.status = response.status; if (!response.ok) return { values: [], diagnostics };
  const data = await response.json(); diagnostics.results = (data?.results ?? []).length;
  return { values: uniqueOptions((data?.results ?? []).map((item) => ({ value: item?.value, displayName: item?.displayName ?? item?.value }))), diagnostics };
}
resolver.define('getProjectSetup', async ({ context }) => {
  const projectKey = projectKeyFromContext(context); if (!projectKey) throw new Error('Project context is unavailable');
  const [fieldsResponse, statusesResponse, resolutionsResponse, rules] = await Promise.all([
    api.asApp().requestJira(route`/rest/api/3/field`), api.asApp().requestJira(route`/rest/api/3/project/${projectKey}/statuses`), api.asApp().requestJira(route`/rest/api/3/resolution`), getRules()
  ]);
  const fields = await readJson(fieldsResponse, 'Load Jira fields'); const statusGroups = await readJson(statusesResponse, 'Load project statuses'); const resolutions = resolutionsResponse.ok ? await resolutionsResponse.json() : [];
  const statusMap = new Map(); for (const issueType of statusGroups ?? []) for (const status of issueType.statuses ?? []) statusMap.set(status.id, { id: status.id, name: status.name });
  return { projectKey, fields: (fields ?? []).filter((f) => f?.id && f?.name).map((f) => ({ id:f.id,name:f.name,custom:Boolean(f.custom),schemaType:f.schema?.type??null,schemaCustom:f.schema?.custom??null })).sort((a,b)=>a.name.localeCompare(b.name)), statuses:[...statusMap.values()].sort((a,b)=>a.name.localeCompare(b.name)), resolutions:(resolutions??[]).map((r)=>({id:r.id,name:r.name})).sort((a,b)=>a.name.localeCompare(b.name)), rules:rules.filter((r)=>r.projectKey===projectKey) };
});
resolver.define('getFieldOptions', async ({ payload, context }) => {
  const projectKey = projectKeyFromContext(context); const fieldId = String(payload?.fieldId ?? '').trim(); const fieldName = String(payload?.fieldName ?? '').trim();
  if (!projectKey || !fieldId) return { values: [], source: 'none', diagnostics: { projectKey, fieldId, fieldName } };
  const sources = []; const diagnostics = { projectKey, fieldId, fieldName, metadata:null, observed:null, autocomplete:null };
  try { const result = await getProjectFieldAllowedValues(projectKey, fieldId); diagnostics.metadata=result.diagnostics; sources.push(...result.values); } catch(e) { diagnostics.metadata={error:String(e?.message??e)}; }
  try { const result = await searchObservedValues(projectKey, fieldId, fieldName); diagnostics.observed=result.diagnostics; sources.push(...result.values); } catch(e) { diagnostics.observed={error:String(e?.message??e)}; }
  try { const result = await getJqlSuggestions(fieldName); diagnostics.autocomplete=result.diagnostics; sources.push(...result.values); } catch(e) { diagnostics.autocomplete={error:String(e?.message??e)}; }
  const values = uniqueOptions(sources).slice(0,300); return { values, source: values.length ? 'jira' : 'none', diagnostics };
});
resolver.define('getFieldSuggestions', async ({ payload }) => { const result=await getJqlSuggestions(String(payload?.fieldName??'').trim(),String(payload?.fieldValue??'').trim()); return { values:result.values }; });
resolver.define('searchParticipants', async ({ payload }) => { const query=String(payload?.query??'').trim(); if(query.length<2)return{users:[]}; const response=await api.asApp().requestJira(route`/rest/api/3/groupuserpicker?query=${query}&maxResults=20&showAvatar=true&caseInsensitive=true&excludeConnectAddons=true`); if(!response.ok)return{users:[]}; const data=await response.json(); return {users:(data?.users?.users??[]).filter(u=>u?.accountId&&u?.displayName).map(u=>({accountId:u.accountId,displayName:u.displayName,avatarUrl:u.avatarUrl??null})).slice(0,20)}; });
resolver.define('saveRule', async ({ payload, context }) => { const projectKey=projectKeyFromContext(context); const rule={...payload.rule,projectKey}; const errors=validateRule(rule); if(errors.length)return{ok:false,errors}; await saveRule(rule); return{ok:true,rule}; });
resolver.define('deleteRule', async ({ payload, context }) => { const projectKey=projectKeyFromContext(context); const rules=await getRules(); const rule=rules.find(i=>i.id===payload.ruleId); if(!rule||rule.projectKey!==projectKey)throw new Error('Rule not found in this project'); await deleteRule(payload.ruleId); return{ok:true}; });
resolver.define('getIssuePanel', async ({ context }) => { const issueKey=issueKeyFromContext(context); if(!issueKey)throw new Error('Issue context is unavailable'); const issue=await getIssue(issueKey); const [cycle,audit,rules]=await Promise.all([getCycle(issue.id),getAudit(issue.id),getRules()]); const rule=cycle?rules.find(i=>i.id===cycle.ruleId)??null:null; return{issue:{id:issue.id,key:issue.key,summary:issue.fields?.summary,status:issue.fields?.status?.name},cycle:cycle??null,rule,audit:audit.slice(-20).reverse()}; });
resolver.define('pauseCycle', async ({ context }) => { const issueKey=issueKeyFromContext(context); const issue=await getIssue(issueKey); const cycle=await getCycle(issue.id); if(!cycle?.active)return{ok:false,error:'No active follow-up cycle'}; if(cycle.paused)return{ok:true}; cycle.paused=true; cycle.pausedAt=new Date().toISOString(); await saveCycle(cycle); await appendAudit(issue.id,'cycle-paused',{issueKey}); return{ok:true}; });
resolver.define('resumeCycle', async ({ context }) => { const issueKey=issueKeyFromContext(context); const issue=await getIssue(issueKey); const cycle=await getCycle(issue.id); if(!cycle?.active)return{ok:false,error:'No active follow-up cycle'}; if(cycle.paused&&cycle.pausedAt){const pausedMs=Date.now()-new Date(cycle.pausedAt).getTime();cycle.startedAt=new Date(new Date(cycle.startedAt).getTime()+pausedMs).toISOString();} cycle.paused=false;cycle.pausedAt=null;await saveCycle(cycle);await appendAudit(issue.id,'cycle-resumed',{issueKey});return{ok:true}; });
resolver.define('cancelCycle', async ({ context }) => { const issueKey=issueKeyFromContext(context);const issue=await getIssue(issueKey);await deleteCycle(issue.id);await appendAudit(issue.id,'cycle-cancelled',{issueKey,reason:'Cancelled manually by agent'});return{ok:true}; });
resolver.define('restartCycle', async ({ context }) => { const issueKey=issueKeyFromContext(context);const issue=await getIssue(issueKey);await deleteCycle(issue.id);const rules=await getRules();const cycle=await reconcileIssue(issue,rules);if(!cycle)return{ok:false,error:'This issue does not currently match a follow-up rule'};await appendAudit(issue.id,'cycle-restarted',{issueKey,ruleId:cycle.ruleId});return{ok:true}; });
export const handler = resolver.getDefinitions();
