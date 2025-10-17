export function centsToXtr(cents) {
  const n = Math.max(0, Number(cents || 0));
  return Math.ceil(n / 100); // 100 центов => 1 XTR, округление вверх
}
