// budget-view — the strip on the Spend tab, the budgets list + editor, and the warning note
// that rides on the log toast (one toast at a time: a separate warning toast would hide Undo).
import { el, openModal, toast } from './ui.js';
import { store, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { nowTs } from './dates.js';
import { SCOPES, PERIODS, evaluate, mostAtRisk, warningsToFire } from './budgets.js';
import { amountField } from './fields.js';

export function budgetName(budget) {
  if (budget.scope === 'all') return 'all spending';
  const list = budget.scope === 'category' ? store.state.categories : store.state.items;
  return list.find((r) => r.id === budget.refId)?.name || '(removed)';
}

// boot loads this month + the previous 3, so the current day / week (which may start
// last month) / month is always inside loadedEntries() — no async load needed here.
const evaluateAll = () => store.state.budgets.map((b) => evaluate(b, store.loadedEntries(), nowTs()));

const STATUS_TEXT = { 'on track': 'on track', ahead: 'ahead of pace', over: 'over' };

function budgetRow(ev) {
  const pct = Math.round(ev.spentFrac * 100);
  return el('div', { class: 'budget-row' },
    el('div', { class: 'budget-top' },
      el('span', {}, `${budgetName(ev.budget)} · ${ev.budget.period}`),
      el('span', { class: 'budget-nums' }, `${formatINR(ev.spent)} / ${formatINR(ev.budget.limit)}`),
    ),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill' + (ev.status === 'over' ? ' over' : ''), style: { width: `${Math.min(100, pct)}%` } })),
    el('div', { class: `budget-status ${ev.status.replace(' ', '-')}` }, `${pct}% · ${STATUS_TEXT[ev.status]}`),
  );
}

export function renderBudgetStrip() {
  const evals = evaluateAll();
  if (!evals.length) return el('div', { hidden: true });
  return el('button', { class: 'budget-strip', onClick: openBudgetsModal }, ...mostAtRisk(evals, 3).map(budgetRow));
}

// call right after a successful log/edit. returns e.g. "Food 80% month budget", or null.
// marks each warning shown so it fires once per budget per level per period.
export async function takeBudgetNote() {
  try {
    const due = warningsToFire(evaluateAll(), store.state.meta.budgetWarnings || {});
    for (const w of due) await store.markBudgetWarned(w.budgetId, w.periodKey, w.level);
    if (!due.length) return null;
    return due
      .map((w) => `${budgetName(w.eval.budget)} ${w.level >= 100 ? 'over' : '80%'} ${w.eval.budget.period} budget`)
      .join(', ');
  } catch {
    return null; // a warning must never break logging
  }
}

export const withNote = (msg, note) => (note ? `${msg} — ${note}` : msg);

// ============================================================
//  list + editor
// ============================================================
export function openBudgetsModal() {
  openModal('budgets', (body, close) => {
    const evals = evaluateAll().sort((a, b) => b.spentFrac - a.spentFrac);
    if (!evals.length) {
      body.append(el('div', { class: 'settings-info' },
        'no budgets yet. a budget is a limit on everything, a category or an item, per day, week or month.'));
    }
    for (const ev of evals) {
      body.append(el('button', { class: 'budget-list-item', onClick: () => { close(); openBudgetEditor(ev.budget); } }, budgetRow(ev)));
    }
    body.append(el('div', { class: 'modal-actions' },
      el('button', { class: 'btn-primary', onClick: () => { close(); openBudgetEditor(null); } }, '+ add budget')));
  });
}

function chipField(label, options, value, onChange) {
  const row = el('div', { class: 'chips' });
  const draw = () => row.replaceChildren(...options.map((o) => el('button', {
    type: 'button',
    class: 'chip' + (o === value ? ' active' : ''),
    onClick: () => { value = o; onChange(o); draw(); },
  }, o)));
  draw();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label), row);
}

function openBudgetEditor(budget) {
  openModal(budget ? 'edit budget' : 'new budget', (body, close) => {
    const f = {
      scope: budget?.scope ?? 'category',
      refId: budget?.refId ?? '',
      period: budget?.period ?? 'month',
      limit: budget?.limit ?? null,
    };
    const target = el('div');
    const drawTarget = () => {
      target.replaceChildren();
      if (f.scope === 'all') return;
      const list = (f.scope === 'category' ? store.state.categories : store.state.items)
        .filter((r) => !r.archived || r.id === f.refId)
        .sort((a, b) => a.name.localeCompare(b.name));
      const select = el('select', { class: 'input', onChange: (e) => { f.refId = e.target.value; } },
        el('option', { value: '' }, 'pick one…'),
        ...list.map((r) => el('option', { value: r.id }, r.name)));
      select.value = list.some((r) => r.id === f.refId) ? f.refId : '';
      f.refId = select.value;
      target.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.scope), select));
    };

    body.append(
      chipField('applies to', SCOPES, f.scope, (v) => { f.scope = v; f.refId = ''; drawTarget(); }),
      target,
      chipField('resets every', PERIODS, f.period, (v) => { f.period = v; }),
      amountField(f.limit, (v) => { f.limit = v; }, 'limit (₹)').node,
    );
    drawTarget();

    const reopenList = () => { close(); rerender(); openBudgetsModal(); };
    const actions = el('div', { class: 'modal-actions' });
    if (budget) {
      actions.append(el('button', {
        class: 'btn-danger-ghost',
        onClick: async () => {
          try { await store.deleteBudget(budget.id); reopenList(); } catch (e) { toast(e.message, 'error'); }
        },
      }, 'delete'));
    }
    actions.append(el('button', {
      class: 'btn-primary',
      onClick: async () => {
        if (!f.limit) return toast('enter a limit', 'error');
        try {
          await store.saveBudget({ id: budget?.id, scope: f.scope, refId: f.scope === 'all' ? null : f.refId, period: f.period, limit: f.limit });
          reopenList();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'save'));
    body.append(actions);
  });
}
