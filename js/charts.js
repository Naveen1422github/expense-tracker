// charts — hand-drawn SVG trend bars + HTML horizontal bars. no chart library.
// trend rects use class "tbar", never "bar": macro's .bar sets height:3px, and CSS height
// overrides an SVG rect's height attribute.
import { el } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const FIT_MAX = 31;      // up to this many bars fit the screen width; more scroll sideways
const SCROLL_BAR_PX = 28; // width per bar when scrolling

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// bars: [{key, label, value}]. tapping a bar calls onSelect(key).
// each bar owns a 10-unit slot in a 0..100 tall viewBox, stretched to the container.
export function barChart({ bars, selectedKey = null, onSelect }) {
  const n = bars.length;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const fits = n <= FIT_MAX;
  const svg = svgEl('svg', { viewBox: `0 0 ${n * 10} 100`, preserveAspectRatio: 'none', class: 'bar-chart-svg' });
  bars.forEach((b, i) => {
    const h = b.value ? Math.max(2, (b.value / max) * 96) : 0;
    const cls = 'tbar' + (selectedKey === b.key ? ' selected' : selectedKey ? ' dim' : '');
    svg.appendChild(svgEl('rect', { x: i * 10 + 1.5, y: 100 - h, width: 7, height: h, class: cls }));
    // full-height invisible hit area so thin or zero bars are still tappable
    const hit = svgEl('rect', { x: i * 10, y: 0, width: 10, height: 100, class: 'tbar-hit' });
    hit.dataset.key = b.key;
    svg.appendChild(hit);
  });
  svg.addEventListener('click', (e) => {
    const key = e.target.dataset?.key;
    if (key) onSelect(key);
  });
  const step = fits ? Math.ceil(n / 8) : 2; // label every Nth bar so labels never collide
  const labels = el('div', { class: 'bar-labels' },
    ...bars.map((b, i) => el('span', {}, i % step === 0 ? b.label : '')));
  const inner = el('div', { class: 'chart-inner', style: fits ? {} : { minWidth: `${n * SCROLL_BAR_PX}px` } }, svg, labels);
  return el('div', { class: 'chart-scroll' }, inner);
}

// rows: [{label, value, pct, active, onClick}]
export function hBars(rows, formatValue) {
  return el('div', { class: 'hbars' },
    ...rows.map((r) => el('button', { class: 'hbar' + (r.active ? ' active' : ''), onClick: r.onClick },
      el('div', { class: 'hbar-top' },
        el('span', { class: 'hbar-label' }, r.label),
        el('span', { class: 'hbar-value' }, `${formatValue(r.value)} · ${Math.round(r.pct)}%`)),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: { width: `${Math.max(1, r.pct)}%` } })),
    )),
  );
}
