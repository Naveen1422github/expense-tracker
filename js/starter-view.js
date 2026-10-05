// starter picker — first-open "what do you buy often?" modal, also reachable from settings and the empty grid.
import { el, openModal, toast } from './ui.js';
import { store, rerender } from './ctx.js';
import { formatINR } from './money.js';
import { amountField } from './fields.js';
import { STARTER_GROUPS, STARTER_ITEMS, planStarter, applyStarter } from './starter.js';

const FLAG = 'kharchly:starter-seen';
export function starterSeen() {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return true; }
}
function markStarterSeen() {
  try { localStorage.setItem(FLAG, '1'); } catch { /* storage blocked — fine */ }
}

const exists = (name) => store.state.items.some((i) => i.name.toLowerCase() === name.toLowerCase());

export function openStarterPicker({ firstRun = false } = {}) {
  const picked = new Map(); // name -> pick (price editable)
  openModal(firstRun ? 'welcome to kharchly' : 'add common items', (body, close, onClose) => {
    if (firstRun) onClose(markStarterSeen);
    const list = el('div');
    const prices = el('div');
    const add = el('button', { class: 'btn-primary' }, 'add');

    const drawPrices = () => {
      prices.replaceChildren();
      if (!picked.size) return;
      prices.appendChild(el('div', { class: 'settings-section-title', style: { marginTop: '16px' } }, 'prices — edit if yours differ'));
      for (const p of picked.values()) {
        prices.appendChild(el('div', { class: 'starter-price-row' },
          amountField(p.price, (v) => { if (v != null && v > 0) p.price = v; }, p.name).node));
      }
    };
    const draw = () => {
      list.replaceChildren();
      for (const group of STARTER_GROUPS) {
        const items = STARTER_ITEMS.filter((i) => i.group === group && !exists(i.name));
        if (!items.length) continue;
        list.appendChild(el('div', { class: 'settings-section-title', style: { marginTop: '12px' } }, group));
        const row = el('div', { class: 'chips starter-chips' });
        for (const it of items) {
          const on = picked.has(it.name);
          row.appendChild(el('button', {
            class: 'chip' + (on ? ' active' : ''),
            onClick: () => { if (on) picked.delete(it.name); else picked.set(it.name, { ...it }); draw(); drawPrices(); },
          }, `${it.name} · ${formatINR(it.price)}`));
        }
        list.appendChild(row);
      }
      add.textContent = picked.size ? `add ${picked.size} item${picked.size > 1 ? 's' : ''}` : 'add';
    };

    add.addEventListener('click', async () => {
      if (!picked.size) return toast('pick at least one, or skip', 'error');
      try {
        const plan = planStarter([...picked.values()], store.state);
        await applyStarter(store, plan);
        close();
        rerender();
        toast(`${plan.items.length} items added — tap one to log it`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    });

    body.append(
      el('div', { class: 'settings-info', style: { fontSize: '12px', marginTop: 0 } },
        'kharchly is built for everyday buys. pick what you buy often — one tap logs it later. you can add your own anytime with +.'),
      list,
      prices,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: close }, firstRun ? 'skip' : 'cancel'),
        add,
      ),
    );
    draw();
  });
}
