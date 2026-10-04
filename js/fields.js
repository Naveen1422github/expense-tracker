// fields — small form building blocks shared by spend + settings modals.
// each field reports changes through onChange; callers keep their own form object.
import { el, toast } from './ui.js';
import { store } from './ctx.js';
import { toPaise, toInputValue } from './money.js';
import { dayKey, timeOf, joinTs, todayKey } from './dates.js';
import { KINDS, KIND_LABELS } from './ledger.js';

export function textField(label, value, onChange) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    el('input', { class: 'input', type: 'text', value, maxlength: '80', onInput: (e) => onChange(e.target.value) }),
  );
}

export function noteField(value, onChange) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, 'note (optional)'),
    el('input', { class: 'input', type: 'text', value, maxlength: '200', onInput: (e) => onChange(e.target.value) }),
  );
}

// onChange receives paise, or null while the text is not a valid amount
export function amountField(paise, onChange, label = 'amount (₹)') {
  const input = el('input', {
    class: 'input',
    type: 'text',
    inputmode: 'decimal',
    placeholder: '0',
    value: paise == null ? '' : toInputValue(paise),
    onInput: (e) => onChange(toPaise(e.target.value)),
  });
  return { node: el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input), input };
}

// <select> over a named list + an inline "+ new …" row that creates the record on the spot.
// archived records are hidden unless currently selected.
export function namedSelectField({ label, newLabel, getList, create, selectedId, onChange }) {
  let current = selectedId || '';
  const select = el('select', { class: 'input' });
  const newInput = el('input', { class: 'input', type: 'text', placeholder: `${newLabel} name`, maxlength: '40' });
  const newRow = el('div', { class: 'inline-new', hidden: true });

  const fill = () => {
    select.innerHTML = '';
    select.appendChild(el('option', { value: '' }, 'pick one…'));
    for (const r of getList()) {
      if (r.archived && r.id !== current) continue;
      select.appendChild(el('option', { value: r.id }, r.name));
    }
    select.appendChild(el('option', { value: '__new' }, `+ ${newLabel}`));
    select.value = current;
  };

  select.addEventListener('change', () => {
    if (select.value === '__new') {
      select.value = current;
      newRow.hidden = false;
      newInput.focus();
      return;
    }
    current = select.value;
    onChange(current);
  });

  newRow.append(newInput, el('button', {
    class: 'btn-ghost',
    type: 'button',
    onClick: async () => {
      try {
        const r = await create(newInput.value);
        current = r.id;
        fill();
        onChange(current);
        newInput.value = '';
        newRow.hidden = true;
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'add'));

  fill();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label), select, newRow);
}

export function categoryField(selectedId, onChange) {
  return namedSelectField({
    label: 'category',
    newLabel: 'new category',
    getList: () => store.state.categories,
    create: (name) => store.saveCategory({ name }),
    selectedId,
    onChange,
  });
}

export function personField(selectedId, onChange) {
  return namedSelectField({
    label: 'person',
    newLabel: 'new person',
    getList: () => [...store.state.people].sort((a, b) => a.name.localeCompare(b.name)),
    create: (name) => store.savePerson({ name }),
    selectedId,
    onChange,
  });
}

// one-of-four chips: lent / borrowed / they repaid / i repaid
export function kindField(kind, onChange) {
  const row = el('div', { class: 'chips kind-chips' });
  const draw = () => {
    row.replaceChildren(...KINDS.map((k) => el('button', {
      type: 'button',
      class: 'chip' + (k === kind ? ' active' : ''),
      onClick: () => { kind = k; onChange(k); draw(); },
    }, KIND_LABELS[k])));
  };
  draw();
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'what happened'), row);
}

export function tagToggles(selectedIds, onChange) {
  const selected = new Set(selectedIds);
  const row = el('div', { class: 'chips' });
  for (const t of store.state.tags) {
    const chip = el('button', {
      type: 'button',
      class: 'chip' + (selected.has(t.id) ? ' active' : ''),
      onClick: () => {
        if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id);
        chip.classList.toggle('active', selected.has(t.id));
        onChange([...selected]);
      },
    }, t.name);
    row.appendChild(chip);
  }
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'tags (optional)'), row);
}

// future dates are not allowed (max = today)
export function dateTimeFields(ts, onChange) {
  let day = dayKey(ts);
  let time = timeOf(ts);
  const emit = () => onChange(joinTs(day, time));
  return el('div', { class: 'field-row' },
    el('label', { class: 'field' },
      el('span', { class: 'field-label' }, 'date'),
      el('input', {
        class: 'input', type: 'date', value: day, max: todayKey(),
        onChange: (e) => { if (e.target.value) { day = e.target.value; emit(); } },
      }),
    ),
    el('label', { class: 'field' },
      el('span', { class: 'field-label' }, 'time'),
      el('input', {
        class: 'input', type: 'time', value: time,
        onChange: (e) => { if (e.target.value) { time = e.target.value; emit(); } },
      }),
    ),
  );
}
