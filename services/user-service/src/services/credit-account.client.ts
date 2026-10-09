export class CreditAccountUnavailableError extends Error {
  constructor() {
    super("Credit account service is unavailable. Please retry later.");
  }
}

/** Credit Service owns the collection; User Service sends only the User ID and status. */
export async function syncCreditAccount(userId: string, isActive: boolean): Promise<void> {
  const baseUrl = process.env.CREDIT_SERVICE_URL;
  const apiKey = process.env.CREDIT_INTERNAL_API_KEY;
  if (!baseUrl || !apiKey) throw new CreditAccountUnavailableError();

  let response: Response;
  try {
    const url = new URL(`/credit/accounts/${encodeURIComponent(userId)}`, baseUrl);
    response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new CreditAccountUnavailableError();
  }

  if (response.status !== 204) throw new CreditAccountUnavailableError();
}
