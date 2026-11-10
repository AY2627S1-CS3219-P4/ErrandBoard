const EMAIL_REGEX = /^e\d{7}@u\.nus\.edu$/;

export function normalizeRegistrationEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidRegistrationEmail(value: string): boolean {
  return EMAIL_REGEX.test(normalizeRegistrationEmail(value));
}
