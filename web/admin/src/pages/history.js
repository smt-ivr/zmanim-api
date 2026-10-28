// History of changes (who changed which minyan, how and when) and of sign-ins.
// The super admin can delete entries.
import { api } from '../api.js';
import { VIA, cx, html, useState } from '../lib.js';
import { Button, Empty, ErrorBox, Icon, Modal, Spinner, confirm, toast, toastError, useLoad } from '../ui.js';

export const ACTION_ICON = { create: 'plus', update: 'edit', delete: 'trash', duplicate: 'copy', copy: 'copy', show: 'eye', hide: 'eyeOff', bulk: 'list' };
const when = (iso) => new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function removeEntry(path, then) {
  if (!(await confirm({ title: 'מחיקה מהיומן', body: 'הרשומה תימחק לצמיתות.', confirmLabel: 'מחיקה', danger: true }))) return;
  try { await api.del(path); then(); toast('נמחק מהיומן'); } catch (e) { toastError(e); }
}

/** Change entries. `who`: show who made it; `where`: show the synagogue. */
export function ChangeFeed({ rows, who = true, where = false, canDelete, onDeleted }) {
  return html`<div class="feed">${rows.map((l) => html`<div class="feed-row" key=${l.id}>
    <span class="feed-icon"><${Icon} name=${ACTION_ICON[l.action] || 'edit'} size=${15} /></span>
    <div class="grow"><div>${l.summary}</div>
      <div class="muted small">${[who && (l.user_name || 'משתמש שנמחק'), where && l.synagogue_name, VIA[l.via], when(l.created_at)].filter(Boolean).join(' · ')}</div></div>
    ${canDelete && html`<${Button} kind="ghost" small icon="trash" class="feed-del" title="מחיקה מהיומן" onClick=${() => removeEntry(`/admin/log/${l.id}`, () => onDeleted(l.id))} />`}
  </div>`)}</div>`;
}

/** Everything one user did, and when they signed in. Opened from the users list. */
export function UserHistory({ user, onClose }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/admin/users/${user.id}/history`), [user.id]);
  const [tab, setTab] = useState('changes');
  const drop = (key, id) => setData((d) => ({ ...d, [key]: d[key].filter((x) => x.id !== id) }));
  async function clear() {
    const label = tab === 'changes' ? 'כל השינויים' : 'כל הכניסות';
    if (!(await confirm({ title: `ניקוי ${label}`, body: `${label} של ${user.name} יימחקו מהיומן לצמיתות.`, confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/users/${user.id}/history?kind=${tab}`); setData((d) => ({ ...d, [tab]: [] })); toast('היומן נוקה'); } catch (e) { toastError(e); }
  }
  const rows = data?.[tab] || [];
  return html`<${Modal} title=${`היסטוריה: ${user.name}`} onClose=${onClose} wide>
    <div class="row gap-sm history-tools">
      <div class="segmented small-seg">
        ${[['changes', 'שינויים', data?.changes.length], ['logins', 'כניסות', data?.logins.length]].map(([k, l, n]) =>
          html`<button class=${cx(tab === k && 'on')} onClick=${() => setTab(k)}>${l}${n !== undefined ? ` (${n})` : ''}</button>`)}
      </div>
      <span class="grow" />
      ${data?.can_delete && rows.length > 0 && html`<${Button} kind="ghost" small icon="trash" onClick=${clear}>ניקוי הכל<//>`}
    </div>
    ${loading && !data ? html`<${Spinner} />` : error && !data ? html`<${ErrorBox} error=${error} onRetry=${reload} />`
      : !rows.length ? html`<${Empty} icon="history" title=${tab === 'changes' ? 'אין שינויים רשומים' : 'אין כניסות רשומות'} />`
      : tab === 'changes'
        ? html`<${ChangeFeed} rows=${rows} who=${false} where canDelete=${data.can_delete} onDeleted=${(id) => drop('changes', id)} />`
        : html`<div class="feed">${rows.map((l) => html`<div class="feed-row" key=${l.id}>
            <span class="feed-icon"><${Icon} name=${l.channel === 'phone' ? 'phone' : 'key'} size=${15} /></span>
            <div class="grow"><div>כניסה ${VIA[l.channel]}</div><div class="muted small">${[l.detail, when(l.created_at)].filter(Boolean).join(' · ')}</div></div>
            ${data.can_delete && html`<${Button} kind="ghost" small icon="trash" class="feed-del" title="מחיקה מהיומן" onClick=${() => removeEntry(`/admin/logins/${l.id}`, () => drop('logins', l.id))} />`}
          </div>`)}</div>`}
  <//>`;
}
