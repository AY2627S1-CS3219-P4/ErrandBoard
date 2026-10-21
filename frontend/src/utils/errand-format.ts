function compact(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function timeLeft(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? "Expired" : `${compact(ms)} left`;
}

export function timeAgo(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  return ms < 60_000 ? "just now" : `${compact(ms)} ago`;
}

export function formatCredits(credit: number): string {
  return `${credit} ${credit === 1 ? "credit" : "credits"}`;
}
