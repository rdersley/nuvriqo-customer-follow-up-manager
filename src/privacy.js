import { privacy } from '@forge/api';
import {
  erasePersonalDataForAccount,
  getPersonalDataAccounts,
  markPersonalDataRefreshed
} from './storage.js';

// The personal data reporting API accepts at most 90 accounts per request.
export const PRIVACY_REPORT_BATCH_SIZE = 90;

export function chunk(items, size = PRIVACY_REPORT_BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < (items ?? []).length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function processPrivacy() {
  const accounts = await getPersonalDataAccounts();
  if (accounts.length === 0) return;

  const reports = accounts.map((account) => ({
    accountId: account.accountId,
    updatedAt: account.updatedAt ?? new Date(0).toISOString()
  }));

  let closed = 0;
  for (const batch of chunk(reports)) {
    const updates = await privacy.reportPersonalData(batch);

    for (const update of updates ?? []) {
      if (!update?.accountId) continue;

      if (update.status === 'closed') {
        await erasePersonalDataForAccount(update.accountId);
        closed += 1;
        continue;
      }

      if (update.status === 'updated') {
        // Nuvriqo deliberately stores only the stable Atlassian account ID, not
        // mutable profile attributes such as email or display name. There is no
        // profile payload to refresh; mark the reference as reviewed/current.
        await markPersonalDataRefreshed(update.accountId);
      }
    }
  }

  // Account IDs are personal data, so only the count is logged.
  if (closed > 0) console.info(`Removed Nuvriqo participant references for ${closed} closed account(s)`);
}
