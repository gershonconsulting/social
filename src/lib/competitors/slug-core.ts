/**
 * v4.83.1: first free slug among base, base-2 … base-20, then a random suffix.
 * Pure (the "taken" check is passed in) so it can be unit-tested without a database.
 */
export async function pickFreeSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let i = 2; i <= 20; i++) {
    const s = `${base}-${i}`;
    if (!(await isTaken(s))) return s;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
