// money — every amount in the app is an integer number of paise.
// floats never reach storage: "45.5" becomes 4550 at the input boundary.

// "45.5" | "₹1,234.05" | 12.5 -> paise, or null when the input is not a valid amount.
export function toPaise(input) {
  const s = String(input ?? '').replace(/[₹,\s]/g, '');
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return null;
  return Number(m[1] || '0') * 100 + Number(((m[2] || '') + '00').slice(0, 2));
}

// "123456789" -> "12,34,56,789"
export function groupIndian(digits) {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}

// 4550 -> "₹45.50", 4500 -> "₹45" (or "₹45.00" with fixed)
export function formatINR(paise, { fixed = false } = {}) {
  const abs = Math.abs(Math.round(paise));
  const p = abs % 100;
  const frac = fixed || p ? '.' + String(p).padStart(2, '0') : '';
  return (paise < 0 ? '-' : '') + '₹' + groupIndian(String(Math.floor(abs / 100))) + frac;
}

// 4550 -> "45.50" (CSV, exports)
export function toRupeesString(paise) {
  const abs = Math.abs(paise);
  return (paise < 0 ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

// value to prefill an <input>: "45" for whole rupees, "45.50" otherwise
export function toInputValue(paise) {
  return paise % 100 ? toRupeesString(paise) : String(paise / 100);
}
