/** Read-only receipt checks. This controller has no signing or send operation. */
export function startPurchaseStatusPolling({
  pending,
  active,
  check,
  clock = Date.now,
  schedule = (work, delay) => {
    const timer = setTimeout(work, delay);
    return () => clearTimeout(timer);
  },
}: {
  pending: () => boolean;
  active: () => boolean;
  // null means another operation is already in flight; false is a read failure.
  check: () => Promise<boolean | null>;
  clock?: () => number;
  schedule?: (work: () => void, delay: number) => () => void;
}) {
  const deadline = clock() + 120000;
  let stopped = false;
  let errors = 0;
  let cancel: (() => void) | undefined;
  function stop() {
    stopped = true;
    cancel?.();
  }
  function next(delay: number) {
    if (!stopped && clock() + delay < deadline && pending()) cancel = schedule(() => void tick(), delay);
  }
  async function tick() {
    if (stopped || clock() >= deadline || !pending()) return;
    if (!active()) {
      next(5000);
      return;
    }
    let result: boolean | null;
    try {
      result = await check();
    } catch {
      result = false;
    }
    if (stopped) return;
    if (result === false) errors++;
    else if (result === true) errors = 0;
    // Leave manual recovery available after a bounded window or repeated errors.
    // Never infer chain failure, clear a receipt, sign or resend on a timeout.
    if (errors < 3) next(Math.min(30000, 5000 * 2 ** errors));
  }
  next(5000);
  return stop;
}
