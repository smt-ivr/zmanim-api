// The four reference lists every synagogue uses: prayers, anchors (for relative times), seasons and areas.
import { api } from '../api.js';
import { cx, html, useState } from '../lib.js';
import { PhonePanel } from './admin-phone.js';
import { Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Input, Spinner, Toggle, confirm, toast, toastError, useLoad } from '../ui.js';

const KINDS = {
  prayers: { title: 'סוגי תפילה', one: 'תפילה', hint: 'אפשר להגדיר טווח שעות מותר לכל תפילה. מניין בשעה קבועה מחוץ לטווח לא יישמר.' },
  anchors: { title: 'זמני ייחוס', one: 'זמן ייחוס', hint: 'נקודות זמן למניינים יחסיים, למשל "15 דק׳ לפני שקיעה". לכל זמן ייחוס אפשר להגביל לאילו תפילות הוא מותר.' },
  seasons: { title: 'עונות', one: 'עונה', hint: 'מניין יכול להיות לכל השנה או לעונה מסוימת. עונת ברירת המחדל מוצגת ראשונה לציבור.' },
  areas: { title: 'אזורים', one: 'אזור', hint: 'לחלוקת בתי הכנסת לפי שכונה או עיר, ולסינון בממשק הציבורי.' },
};

export function AdminCatalog() {
  const [kind, setKind] = useState('prayers');
  return html`<div class="page">
    <header class="page-head"><div><h1>הגדרות ורשימות</h1><p class="muted">רשימות משותפות לכל בתי הכנסת</p></div></header>
    <div class="tabs">
      ${Object.entries(KINDS).map(([k, d]) => html`<button class=${cx('tab', kind === k && 'active')} onClick=${() => setKind(k)}>${d.title}</button>`)}
      <button class=${cx('tab', kind === 'phone' && 'active')} onClick=${() => setKind('phone')}>שלוחת טלפון</button>
    </div>
    ${kind === 'phone' ? html`<${PhonePanel} />` : html`<${CatalogList} key=${kind} kind=${kind} />`}
  </div>`;
}

function CatalogList({ kind }) {
  const def = KINDS[kind];
  const { data, error, loading, reload } = useLoad(() => api.get(`/admin/catalog/${kind}`), [kind]);
  const prayers = useLoad(() => (kind === 'anchors' ? api.get('/admin/catalog/prayers') : Promise.resolve([])), [kind]).data || [];
  const [editing, setEditing] = useState(null);

  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;

  async function remove(row) {
    if (!(await confirm({ title: `מחיקת ${row.name}`, body: 'למחוק מהרשימה?', confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/catalog/${kind}/${row.id}`); toast('נמחק'); reload(); }
    catch (e) { toastError(e); }
  }
  async function move(i, dir) {
    // Re-number everything so equal sort values cannot get stuck.
    const order = data.map((r) => r.id);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    try {
      await Promise.all(order.map((rid, idx) => api.patch(`/admin/catalog/${kind}/${rid}`, { sort: (idx + 1) * 10 })));
      reload();
    } catch (e) { toastError(e); }
  }

  return html`<section class="narrow-section">
    <div class="toolbar"><p class="muted grow">${def.hint}</p><${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>הוספת ${def.one}<//></div>
    ${data.length === 0
      ? html`<${Empty} title="הרשימה ריקה" />`
      : html`<div class="card list">${data.map((r, i) => html`<div class="list-row" key=${r.id}>
          <div class="order-btns">
            <${Button} kind="ghost" small icon="up" title="למעלה" disabled=${i === 0} onClick=${() => move(i, -1)} />
            <${Button} kind="ghost" small icon="down" title="למטה" disabled=${i === data.length - 1} onClick=${() => move(i, 1)} />
          </div>
          <div class="grow"><b>${r.name}</b>
            ${kind === 'prayers' && (r.earliest || r.latest) && html` <span class="muted small" dir="ltr">${r.earliest || '00:00'}–${r.latest || '23:59'}</span>`}
            ${r.is_default && html` <${Badge} tone="info">ברירת מחדל<//>`}
            ${kind === 'anchors' && html` <span class="muted small">${r.prayer_ids?.length ? `ל${prayers.filter((p) => r.prayer_ids.includes(p.id)).map((p) => p.name).join(', ')} בלבד` : 'לכל התפילות'}</span>`}
          </div>
          <span class="muted small">${r.used ? `בשימוש: ${r.used}` : 'לא בשימוש'}</span>
          <${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => setEditing(r)} />
          <${Button} kind="ghost" small icon="trash" title=${r.used ? 'לא ניתן למחוק ערך שבשימוש' : 'מחיקה'} disabled=${r.used > 0} onClick=${() => remove(r)} />
        </div>`)}</div>`}
    ${editing && html`<${CatalogModal} kind=${kind} prayers=${prayers} row=${editing === 'new' ? null : editing} count=${data.length}
        onClose=${() => setEditing(null)} onSaved=${reload} />`}
  </section>`;
}

function CatalogModal({ kind, prayers, row, count, onClose, onSaved }) {
  const def = KINDS[kind];
  const initial = { name: row?.name ?? '', earliest: row?.earliest ?? '', latest: row?.latest ?? '', is_default: row?.is_default ?? false, prayer_ids: row?.prayer_ids ?? [] };
  const save = (v) => {
    const body = { name: v.name };
    if (kind === 'prayers') Object.assign(body, { earliest: v.earliest || null, latest: v.latest || null });
    if (kind === 'seasons') body.is_default = v.is_default;
    if (kind === 'anchors') body.prayer_ids = v.prayer_ids;
    if (!row) body.sort = (count + 1) * 10;
    return row ? api.patch(`/admin/catalog/${kind}/${row.id}`, body) : api.post(`/admin/catalog/${kind}`, body);
  };
  return html`<${FormModal} title=${row ? `עריכת ${row.name}` : `הוספת ${def.one}`} initial=${initial} save=${save} onClose=${onClose}
      onSaved=${() => { onSaved(); toast('נשמר'); }}>
    ${({ values: v, set, errors }) => html`
      <${Field} label="שם" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} required maxlength="60" /><//>
      ${kind === 'prayers' && html`<div class="grid-2">
        <${Field} label="לא לפני" error=${errors.earliest} hint="ריק = ללא הגבלה"><${Input} type="time" dir="ltr" value=${v.earliest} onInput=${set('earliest')} /><//>
        <${Field} label="לא אחרי" error=${errors.latest} hint="ריק = ללא הגבלה"><${Input} type="time" dir="ltr" value=${v.latest} onInput=${set('latest')} /><//>
      </div>`}
      ${kind === 'seasons' && html`<${Toggle} checked=${v.is_default} onChange=${set('is_default')} label="עונת ברירת מחדל" />`}
      ${kind === 'anchors' && html`<${Field} group label="מותר לתפילות" hint="לא סומן כלום = מותר לכל התפילות" error=${errors.prayer_ids}>
        <${CheckList} options=${prayers.map((p) => ({ value: p.id, label: p.name }))} value=${v.prayer_ids} onChange=${set('prayer_ids')} /><//>`}`}
  <//>`;
}
