import { privacy } from '@forge/api';
import {
  erasePersonalDataForAccount,
  getPersonalDataAccounts,
  markPersonalDataRefreshed
} from './storage.js';

export async function processPrivacy() {
  const accounts = await getPersonalDataAccounts();
  if (accounts.length === 0) return;

  const reports = accounts.map((account) => ({
    accountId: account.accountId,
    updatedAt: account.updatedAt ?? new Date(0).toISOString()
  }));

  const updates = await privacy.reportPersonalData(reports);

  for (const update of updates ?? []) {
    if (!update?.accountId) continue;

    if (update.status === 'closed') {
      await erasePersonalDataForAccount(update.accountId);
      console.info(`Removed Nuvriqo participant references for closed account ${update.accountId}`);
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
