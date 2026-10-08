const TRANSIENT_PATTERNS = [
  /timed out acquiring connection from connection pool/i,
  /connection pool/i,
  /network.*failed/i,
  /fetch failed/i,
  /gateway timeout/i,
  /service unavailable/i,
  /too many requests/i,
  /schema cache/i,
  /could not query the database/i
];

export function isTransientServiceError(error) {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(error?.message || String(error)));
}

export function friendlyServiceError(error) {
  if (isTransientServiceError(error)) {
    return 'Online service is temporarily busy. Your data was not changed — please try again in a moment.';
  }
  if (/row-level security|permission denied|not authorized/i.test(error?.message || '')) {
    return 'You do not have permission to perform that action in this tournament.';
  }
  return error?.message || 'Something went wrong. Please try again.';
}

export async function retryRead(operation, { attempts = 3, baseDelayMs = 180, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientServiceError(error) || attempt === attempts - 1) throw error;
      await sleep(baseDelayMs * (2 ** attempt));
    }
  }
  throw lastError;
}
