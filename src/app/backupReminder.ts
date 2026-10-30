import * as db from "../db";

// Veri kaybı en büyük risk: vurgular yalnızca bu tarayıcıda. Düzenli yedek hatırlatılır (engellemeden).

interface BackupState {
  at?: number;
  snoozeUntil?: number;
}

const KEY = "backup";
const WEEK = 7 * 86_400_000;

export async function backupDue(items: number, now = Date.now()): Promise<{ due: boolean; lastAt?: number }> {
  const s = (await db.getMeta<BackupState>(KEY)) ?? {};
  const due = items > 0 && now >= (s.snoozeUntil ?? 0) && (!s.at || now - s.at > WEEK);
  return { due, lastAt: s.at };
}

export async function markBackedUp(now = Date.now()): Promise<void> {
  await db.putMeta(KEY, { at: now } satisfies BackupState);
}

export async function snoozeBackup(days = 3, now = Date.now()): Promise<void> {
  const s = (await db.getMeta<BackupState>(KEY)) ?? {};
  await db.putMeta(KEY, { ...s, snoozeUntil: now + days * 86_400_000 });
}
