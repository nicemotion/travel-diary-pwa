// backupReminder.js — nudges the person to export a backup after enough
// time or enough new content (places or notes) piles up. Pure localStorage
// bookkeeping (not IndexedDB): this is app metadata about backup habits,
// not user data, so it's deliberately left out of the backup/restore
// payload itself.

const KEY_LAST_BACKUP = 'td_last_backup_at';
const KEY_ENTRIES_SINCE = 'td_entries_since_backup';
const KEY_SNOOZED_AT = 'td_reminder_snoozed_at';

const DAYS_THRESHOLD = 7;
const ENTRIES_THRESHOLD = 10;
const SNOOZE_HOURS = 24; // "remind me later" hides the banner for this long

// call after saving a new place OR a new note — both count as new content
// that isn't in any backup file yet
export function noteContentAdded() {
  const n = Number(localStorage.getItem(KEY_ENTRIES_SINCE) || 0) + 1;
  localStorage.setItem(KEY_ENTRIES_SINCE, String(n));
}

export function noteBackupCompleted() {
  localStorage.setItem(KEY_LAST_BACKUP, String(Date.now()));
  localStorage.setItem(KEY_ENTRIES_SINCE, '0');
  localStorage.removeItem(KEY_SNOOZED_AT);
}

export function snoozeReminder() {
  localStorage.setItem(KEY_SNOOZED_AT, String(Date.now()));
}

// Returns whether the banner should show right now, plus the numbers behind
// that decision so the UI can explain why ("12 new places since your last
// backup" vs "it's been 9 days").
export function getReminderState() {
  const lastBackupAt = Number(localStorage.getItem(KEY_LAST_BACKUP) || 0);
  const entriesSince = Number(localStorage.getItem(KEY_ENTRIES_SINCE) || 0);
  const snoozedAt = Number(localStorage.getItem(KEY_SNOOZED_AT) || 0);

  const daysSince = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / 86400000) : null;
  // a brand-new install with no backup yet only nags via the entry-count
  // threshold, not the day threshold — otherwise day one already feels due
  const dueByDays = lastBackupAt > 0 && daysSince >= DAYS_THRESHOLD;
  const dueByCount = entriesSince >= ENTRIES_THRESHOLD;

  const snoozedRecently = snoozedAt > 0 && (Date.now() - snoozedAt) / 3600000 < SNOOZE_HOURS;

  return {
    due: (dueByDays || dueByCount) && !snoozedRecently,
    entriesSince,
    daysSince,
    neverBackedUp: !lastBackupAt,
  };
}
