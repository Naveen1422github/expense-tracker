// reports tab — spend: range × group trend (tap a bar to drill in), by category (tap to filter
// top items), top items, tag filter, vs previous period. people: the balances list.
// all maths is in report-data.js; this file only draws it.
import { el, attachSwipe } from './ui.js';
import { store, view, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { todayKey, parseDay } from './dates.js';
import {
  RANGE_PRESETS, rangeFor, customRange, allowedGroups, defaultGroup, filterEntries, total,
  trend, byCategory, topItems, previousRange, compare, bucketRange,
} from './report-data.js';
import { barChart, hBars } from './charts.js';
import { renderPeople } from './people.js';

const rep = () => view.report;
const catName = (id) => store.state.categories.find((c) => c.id === id)?.name || '—';
const resetDrill = () => { rep().drill = null; rep().cat = null; };
const shortDay = (d) => parseDay(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const rangeLabel = ({ from, to }) => (from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

function currentRange() {
  if (rep().range === 'custom') return customRange(rep().customFrom, rep().customTo);
  return rangeFor(rep().range, todayKey());
}

function currentGroup(range) {
  return allowedGroups(range).includes(rep().group) ? rep().group : defaultGroup(range);
}

// horizontal chip rows scroll sideways; don't let that also switch tabs
function noTabSwipe(node) {
  attachSwipe(node, () => {}, { stopProp: true });
  return node;
}

function chipRow(options, active, onPick) {
  return noTabSwipe(el('div', { class: 'chips' },
    ...options.map(([value, label]) => el('button', {
      class: 'chip' + (value === active ? ' active' : ''),
      onClick: () => onPick(value),
    }, label))));
}

// ============================================================
//  tab
// ============================================================
export function renderReports() {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('div', { class: 'sub-tabs' },
    ...['spend', 'people'].map((s) => el('button', {
      class: 'sub-tab' + (rep().seg === s ? ' active' : ''),
      onClick: () => { rep().seg = s; rerender(); },
    }, s))));

  if (rep().seg === 'people') {
    pad.appendChild(renderPeople());
    return pad;
  }

  const range = currentRange();
  const group = currentGroup(range);
  pad.appendChild(renderControls(range, group));
  const body = el('div', { class: 'report-body' }, el('div', { class: 'hint' }, 'loading…'));
  pad.appendChild(body);
  fillSpendReport(body, range, group).catch((e) => {
    body.replaceChildren(el('div', { class: 'hint' }, `could not load: ${e.message}`));
  });
  return pad;
}

function renderControls(range, group) {
  const wrap = el('div', { class: 'report-controls' });
  const ranges = [...Object.keys(RANGE_PRESETS).map((k) => [k, k]), ['custom', 'custom']];
  wrap.appendChild(chipRow(ranges, rep().range, (v) => { rep().range = v; rep().group = null; resetDrill(); rerender(); }));

  if (rep().range === 'custom') {
    wrap.appendChild(el('div', { class: 'field-row' },
      dateInput('from', rep().customFrom, (v) => { rep().customFrom = v; }),
      dateInput('to', rep().customTo, (v) => { rep().customTo = v; }),
    ));
  }

  wrap.appendChild(chipRow(allowedGroups(range).map((g) => [g, g]), group,
    (v) => { rep().group = v; resetDrill(); rerender(); }));

  if (store.state.tags.length) {
    const tags = [['', 'all tags'], ...store.state.tags.map((t) => [t.id, t.name])];
    wrap.appendChild(chipRow(tags, rep().tag, (v) => { rep().tag = v; resetDrill(); rerender(); }));
  }
  return wrap;
}

function dateInput(label, value, set) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    el('input', {
      class: 'input', type: 'date', value, max: todayKey(),
      onChange: (e) => {
        if (!e.target.value) return;
        set(e.target.value);
        rep().group = null;
        resetDrill();
        rerender();
      },
    }),
  );
}

// ============================================================
//  spend report
// ============================================================
async function fillSpendReport(body, range, group) {
  const prev = previousRange(range);
  const curAll = await store.loadRange(range.from, range.to);
  const prevAll = await store.loadRange(prev.from, prev.to);
  const cur = filterEntries(curAll, range, rep().tag);
  const curTotal = total(cur);
  const prevTotal = total(filterEntries(prevAll, prev, rep().tag));
  const bars = trend(cur, range, group);

  // a tapped bar narrows the breakdowns to that bucket (ignored if it no longer exists)
  const drillOn = rep().drill && bars.some((b) => b.key === rep().drill);
  const drillRange = drillOn ? bucketRange(rep().drill, group, range) : null;
  const scoped = drillRange ? filterEntries(cur, drillRange) : cur;
  const cats = byCategory(scoped);
  const catOn = rep().cat && cats.some((c) => c.categoryId === rep().cat);
  const itemsScope = catOn ? scoped.filter((e) => e.categoryId === rep().cat) : scoped;

  const parts = [
    totalCard(curTotal, prevTotal, range),
    el('div', { class: 'section-label' }, `trend · by ${group}`),
    curTotal
      ? noTabSwipe(barChart({
        bars,
        selectedKey: drillOn ? rep().drill : null,
        onSelect: (key) => { rep().drill = rep().drill === key ? null : key; rep().cat = null; rerender(); },
      }))
      : el('div', { class: 'hint' }, 'nothing spent in this range'),
    drillRange
      ? el('button', { class: 'link-btn', onClick: () => { resetDrill(); rerender(); } }, `showing ${rangeLabel(drillRange)} · clear`)
      : null,
    el('div', { class: 'section-label' }, 'by category'),
    cats.length
      ? hBars(cats.map((c) => ({
        label: catName(c.categoryId),
        value: c.value,
        pct: c.pct,
        active: rep().cat === c.categoryId,
        onClick: () => { rep().cat = rep().cat === c.categoryId ? null : c.categoryId; rerender(); },
      })), (v) => formatINR(v))
      : el('div', { class: 'hint' }, '—'),
    el('div', { class: 'section-label' }, catOn ? `top items · ${catName(rep().cat)}` : 'top items'),
    topList(topItems(itemsScope)),
  ];
  body.replaceChildren(...parts.filter(Boolean)); // never pass null: replaceChildren would print "null"
}

function totalCard(cur, prev, range) {
  const c = compare(cur, prev);
  const text = c.pct === null
    ? 'nothing to compare with'
    : `${c.delta >= 0 ? '↑' : '↓'} ${Math.abs(c.pct)}% vs previous period (${formatINR(prev)})`;
  const tone = c.pct === null ? '' : c.delta > 0 ? ' up' : ' down';
  return el('div', { class: 'totals-card' },
    el('div', { class: 'metric-label' }, rangeLabel(range).toLowerCase()),
    el('div', { class: 'big-num' }, formatINR(cur)),
    el('div', { class: 'report-compare' + tone }, text),
  );
}

function topList(items) {
  if (!items.length) return el('div', { class: 'hint' }, '—');
  return el('div', {},
    ...items.map((t) => el('div', { class: 'log-row' },
      el('div', { class: 'log-main' },
        el('div', { class: 'log-name' }, t.name),
        el('div', { class: 'log-meta' }, `×${t.count}`)),
      el('div', { class: 'log-amount' }, formatINR(t.value)),
    )),
  );
}
