/**
 * キー入力が文字入力欄へ向けられているかを判定する。
 *
 * ゲームの操作キーは window で受けて preventDefault しているため、
 * この判定を挟まないと部屋コードの入力欄で A・D・W・S・Z などが打てなくなる。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}
