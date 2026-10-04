// ctx — the one shared store instance + transient view state.
// lives in its own module so spend/settings/app can share it without import cycles.
import { kv } from './db.js';
import { createStore } from './store.js';
import { todayKey, addDays } from './dates.js';

export const store = createStore(kv);

// UI-only state; never persisted
export const view = {
  tab: 'spend',      // 'spend' | 'people' | 'reports'
  day: todayKey(),   // day shown on the Spend tab
  search: '',
  chip: 'all',       // 'all' | categoryId
  showSettled: false, // people tab: expand the settled list
  report: {
    seg: 'spend',          // 'spend' | 'people'
    range: '1M',           // '1M' | '3M' | '6M' | '1Y' | 'custom'
    customFrom: addDays(todayKey(), -29),
    customTo: todayKey(),
    group: null,           // null = default for the range
    tag: '',               // '' = all
    drill: null,           // tapped bucket key
    cat: null,             // tapped categoryId
  },
};

let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const rerender = () => renderFn();
