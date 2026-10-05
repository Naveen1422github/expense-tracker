# Kharchly — Plan 7: Logo, Share, Help

> **For agentic workers:** Execute Tasks 1–3 in order, in one pass (no per-task reviewer). Use superpowers:executing-plans when running it inside Claude. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- kharchly gets its own icon instead of macro's: draft **A**, a cream "k" with a green coin dot, picked 2026-10-05.
- A **share** button gives anyone the app link.
- A **`?` help** screen explains the app in about seven short cards.

**Architecture:** `icon.svg` is replaced, and the PNGs are regenerated from it with headless Chrome (zero npm). A new module, `js/help.js`, holds `HELP_CARDS` (data) plus `openHelp()` and `shareApp()`. `app.js` adds two header buttons, and `ui.js` gets two icons.

**Tech Stack:** As before: vanilla ES modules, `node --test`. Zero npm dependencies.

Builds on Plans 1–5 (pushed, `9c75cd1`). Independent of Plan 6. If Plan 6 lands first, add the Drive card noted in Task 2.

## Global Constraints

- **The icon is drawn with paths, never `<text>`.** Fonts differ per phone, which is why the old icon rendered inconsistently.
  - Everything that matters sits inside the maskable safe zone: a circle of radius 205 around (256, 256).
- **Share URL:** the constant `APP_URL = 'https://kharchly.netlify.app/'`, not `location.href`. A share from localhost or from a deep state must still send the real link.
- **Share fallback order:**
  1. `navigator.share`. If the user cancels (`AbortError`), stay silent.
  2. `navigator.clipboard.writeText`, with the toast "link copied".
  3. If that fails too, show a toast with the URL itself so it can be copied by hand.
- **Help copy:**
  - Lowercase, matching the app's voice.
  - Each card has a title and at most 3 short lines.
  - It describes only behaviour that exists. Gestures were checked against the code on 2026-10-05: tap tile = log, hold tile = qty/amount/date/note, undo toast, ‹ › day nav, swipe between tabs, settle, budget scopes all/category/item with periods day/week/month.
- **The SW `CACHE_NAME` bump is mandatory.** The icons are precached by name. See gotcha E-726.
- **No builds. No git write commands.** The user commits. Tests run with `node --test` from `expense-tracker/`. From the main Claude session, delegate test runs to a background subagent.

## File map

| File | Change | Task |
|---|---|---|
| `icon.svg` | **replace** with draft A | 1 |
| `icon-192.png`, `icon-512.png` | **regenerate** from `icon.svg` | 1 |
| `js/help.js` | **create**: `HELP_CARDS`, `openHelp`, `shareApp`, `APP_URL` | 2 |
| `tests/help.test.js` | **create**: card shape and length limits | 2 |
| `js/ui.js` | add the `share` and `help` icons | 3 |
| `js/app.js` | add two header buttons | 3 |
| `style.css` | help-card styles | 3 |
| `sw.js` | add `./js/help.js`, bump `CACHE_NAME` to `kharchly-v8` | 3 |

---

### Task 1: Icon

- [ ] **Step 1: Replace `icon.svg`:**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0f0f0e"/>
  <g fill="none" stroke="#e8e6df" stroke-width="60" stroke-linecap="round" stroke-linejoin="round">
    <path d="M190 128 V384"/><path d="M318 220 L200 310"/><path d="M250 274 L326 384"/>
  </g>
  <circle cx="352" cy="148" r="34" fill="#7fb069"/>
</svg>
```

- [ ] **Step 2: Regenerate the PNGs** (Git Bash, from `expense-tracker/`). Headless Chrome renders the SVG at the exact window size. The wrapper HTML removes the body margin so there's no white edge.

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
for S in 192 512; do
  printf '<html><body style="margin:0;background:#0f0f0e"><img src="icon.svg" width="%s" height="%s"></body></html>' $S $S > _icon.html
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=$S,$S \
    --screenshot="$(pwd -W)/icon-$S.png" "file:///$(pwd -W)/_icon.html"
done
rm _icon.html
```

- [ ] **Step 3: Check** that both PNGs open, are the right size, show the "k" with no white border, and have corners in the dark colour.
  - A full-bleed square is correct for maskable icons: Android does the rounding.
  - If the screenshot comes out 1px off or has a scrollbar, re-run with `--force-device-scale-factor=1`.

### Task 2: help.js

- [ ] **Step 1: Write the failing test** `tests/help.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_CARDS, APP_URL } from '../js/help.js';

test('help cards are short: title + 1..3 lines, each line under 90 chars', () => {
  assert.ok(HELP_CARDS.length >= 5 && HELP_CARDS.length <= 8);
  for (const c of HELP_CARDS) {
    assert.equal(typeof c.title, 'string');
    assert.ok(c.lines.length >= 1 && c.lines.length <= 3, c.title);
    for (const l of c.lines) assert.ok(l.length < 90, `${c.title}: "${l}"`);
  }
});

test('app url is the public https site', () => {
  assert.match(APP_URL, /^https:\/\/kharchly\.netlify\.app\/$/);
});
```

- [ ] **Step 2:** Run `node --test tests/help.test.js`. Expect FAIL (no module).

- [ ] **Step 3: Create `js/help.js`.**
  - `HELP_CARDS` must stay at the top and free of DOM code, so the test can import it under node.
  - The static `ui.js` import is safe under node: `ui.js` has no import-time DOM access (checked 2026-10-05).

```js
// help + share — the "how to use" cards and the share-the-app button.
import { el, openModal, toast } from './ui.js';

export const APP_URL = 'https://kharchly.netlify.app/';

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
    'settings → backup every couple of weeks (the dot reminds you).',
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
```

- [ ] **Step 4:** Run `node --test tests/help.test.js`. Expect PASS. Then run the full `node --test`; all existing tests must pass.
- [ ] **Plan 6 hook:** when Plan 6 lands, change the "keep it safe" card. Its second line becomes `'settings → google drive: backs up by itself after you connect.'`. Line 3 stays.

### Task 3: Wiring

- [ ] **Step 1: In `js/ui.js`**, add to the icon map (feather icons, same stroke style as the others):

```js
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
```

- [ ] **Step 2: In `js/app.js`:**
  - Add `import { openHelp, shareApp } from './help.js';`.
  - In `renderHeader()`'s `header-actions`, put two buttons **before** the settings button:

```js
      el('button', { class: 'icon-btn', 'aria-label': 'Share app', onClick: shareApp }, icon('share', 16)),
      el('button', { class: 'icon-btn', 'aria-label': 'How to use', onClick: openHelp }, icon('help', 16)),
```

- [ ] **Step 3: In `style.css`**, near the settings styles:

```css
.help-card {
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.help-card-title {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 6px;
}
.help-card-line { font-size: 13px; color: var(--text); line-height: 1.5; }
.help-card-line + .help-card-line { margin-top: 2px; }
```

- [ ] **Step 4: In `sw.js`**, add `'./js/help.js',` to `ASSETS` (after `./js/settings.js`) and change `CACHE_NAME` to `'kharchly-v8'`.

- [ ] **Step 5: Manual check** (the user, on a phone after deploy):
  1. The home-screen icon is the new "k". You may have to remove and re-add the app, because Android caches launcher icons.
  2. Share → the phone's share sheet → WhatsApp gets the link.
  3. Desktop: share → "link copied".
  4. `?` → the cards read well and the modal scrolls.
