// help + share — the "how to use" cards and the share-the-app button.
import { el, openModal, toast } from './ui.js';

export const APP_URL = 'https://kharchly.netlify.app/';
export const FEEDBACK_EMAIL = 'prajapatinaveen279@gmail.com';

// the user manual. keep each card to a title + at most 3 short lines (tests enforce it).
// only describe what the app really does.
export const HELP_CARDS = [
  { title: 'log a spend', lines: [
    'tap an item → logged at its price. that\'s it.',
    'hold an item to change qty, amount, date or add a note.',
    '+ adds a new item, or a one-off expense.',
  ] },
  { title: 'oops?', lines: [
    'every log shows undo for a few seconds.',
    'tap any entry in the day list to edit or delete it.',
    '‹ › switches days. new logs go to the day you\'re on.',
  ] },
  { title: 'lend & borrow', lines: [
    'people tab → + → lent, borrowed, or repaid.',
    'each person shows one line: owes you / you owe / settled.',
    'open a person and tap settle to clear it in one go.',
  ] },
  { title: 'budgets', lines: [
    'settings → budgets. limit all spending, a category or an item.',
    'resets every day, week or month.',
    'you get a nudge at 80% and when you go over.',
  ] },
  { title: 'reports', lines: [
    'swipe left/right to move between tabs.',
    'reports: pick 1M · 3M · 6M · 1Y, filter by tag.',
    'tap a category to see its top items.',
  ] },
  { title: 'keep it safe', lines: [
    'your data lives only on this phone.',
    'settings → google drive: backs up by itself once connected.',
    'new phone? settings → restore that file.',
  ] },
  { title: 'put it on your home screen', lines: [
    'android chrome: menu ⋮ → install app.',
    'iphone safari: share → add to home screen.',
  ] },
];

export function openHelp() {
  openModal('how to use', (body) => {
    for (const c of HELP_CARDS) {
      body.appendChild(el('div', { class: 'help-card' },
        el('div', { class: 'help-card-title' }, c.title),
        ...c.lines.map((l) => el('div', { class: 'help-card-line' }, l)),
      ));
    }
    body.appendChild(el('button', { class: 'btn-ghost', style: { width: '100%', marginTop: '8px' }, onClick: shareApp },
      'share kharchly with someone'));
    // opens the phone's mail app with the subject filled in — ideas, bugs, anything.
    body.appendChild(el('button', {
      class: 'btn-ghost', style: { width: '100%', marginTop: '8px' },
      onClick: () => { location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('kharchly feedback')}`; },
    }, 'send feedback'));
    body.appendChild(el('div', { class: 'settings-info', style: { textAlign: 'center', marginTop: '12px' } },
      el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener', style: { color: 'inherit' } }, 'privacy policy')));
  });
}

export async function shareApp() {
  const data = { title: 'kharchly', text: 'one-tap expense tracker — try it:', url: APP_URL };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(APP_URL); toast('link copied', 'success'); }
  catch { toast(APP_URL); }
}
