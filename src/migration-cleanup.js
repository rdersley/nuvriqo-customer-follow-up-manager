import { getRules, deleteRule } from './storage.js';

const CONFIRMATION = 'DELETE_IMPORTED_20260905';
const PREFIX = 'migration-20260905-';

export async function runCleanup(request) {
  try {
    if (request?.method !== 'POST') {
      return { statusCode: 405, headers: {}, body: 'POST required' };
    }
    const payload = JSON.parse(request?.body || '{}');
    if (payload.confirm !== CONFIRMATION) {
      return { statusCode: 403, headers: {}, body: 'Invalid confirmation' };
    }

    const before = await getRules();
    const imported = before.filter((rule) => String(rule.id).startsWith(PREFIX));
    const enabledImported = imported.filter((rule) => rule.enabled);
    if (enabledImported.length) {
      throw new Error(`Safety check failed: ${enabledImported.length} imported rules are enabled`);
    }

    for (const rule of imported) {
      await deleteRule(rule.id);
    }

    const after = await getRules();
    const remaining = after.filter((rule) => String(rule.id).startsWith(PREFIX));
    if (remaining.length) {
      throw new Error(`Cleanup verification failed: ${remaining.length} imported rules remain`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': ['application/json'] },
      body: JSON.stringify({ ok: true, deleted: imported.length, remaining: 0, enabledBeforeDelete: enabledImported.length })
    };
  } catch (error) {
    console.error('One-off migration cleanup failed', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': ['application/json'] },
      body: JSON.stringify({ ok: false, error: error?.message || String(error) })
    };
  }
}
