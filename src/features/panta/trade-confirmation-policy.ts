/** A drag belongs to one review. A new ticket, expiry, interruption or duplicate release cannot confirm it. */
export function createTradeConfirmation() {
  let gesture: { ticket: string; expiresAt: number } | null = null;
  let consumed: string | null = null;
  return {
    begin(ticket: string, expiresAt: number, enabled: boolean, now: number) {
      gesture =
        enabled && Number.isFinite(now) && Number.isFinite(expiresAt) && expiresAt > now && consumed !== ticket
          ? { ticket, expiresAt }
          : null;
      return gesture !== null;
    },
    cancel() {
      gesture = null;
    },
    release(ticket: string, enabled: boolean, progress: number, now: number) {
      const started = gesture;
      gesture = null;
      if (
        !started ||
        started.ticket !== ticket ||
        !enabled ||
        !Number.isFinite(now) ||
        started.expiresAt <= now ||
        !Number.isFinite(progress) ||
        progress < 0.94 ||
        consumed === ticket
      )
        return false;
      consumed = ticket;
      return true;
    },
  };
}
