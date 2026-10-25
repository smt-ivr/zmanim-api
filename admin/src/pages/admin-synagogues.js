import { api } from '../api.js';
import { html, norm, useState } from '../lib.js';
import {
  Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Icon, Input, Select, Spinner, TextArea, Toggle,
  confirm, toast, toastError, useLoad,
} from '../ui.js';

export function AdminSynagogues({ onChanged }) {
  const { data, error, loading, reload, setData } = useLoad(() =>
    Promise.all([api.get('/admin/synagogues'), api.get('/admin/users'), api.get('/admin/catalog/areas'), api.get('/admin/catalog/prayers')])
      .then(([synagogues, users, areas, prayers]) => ({ synagogues, users, areas, prayers }))
  );
  const [q, setQ] = useState('');
  const [area, setArea] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | synagogue

  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const shown = data.synagogues.filter((s) =>
    (area === null || s.area_id === area) &&
    (!q || norm(`${s.name} ${s.address} ${s.managers.map((m) => m.name).join(' ')}`).includes(norm(q))));

  const saved = (s, isNew) => {
    setData((d) => ({ ...d, synagogues: isNew ? [...d.synagogues, s].sort((a, b) => a.name.localeCompare(b.name, 'he')) : d.synagogues.map((x) => (x.id === s.id ? { ...x, ...s } : x)) }));
    onChanged();
    reload();
  };

  async function remove(s) {
    const ok = await confirm({
      title: `מחיקת ${s.name}`,
      body: html`<p>בית הכנסת יימחק יחד עם <b>${s.minyanim_count}</b> מניינים ו-<b>${s.locations_count}</b> מיקומים. לא ניתן לבטל.</p>`,
      confirmLabel: 'מחיקה סופית', danger: true, typeToConfirm: s.name,
    });
    if (!ok) return;
    try { await api.del(`/admin/synagogues/${s.id}`); setData((d) => ({ ...d, synagogues: d.synagogues.filter((x) => x.id !== s.id) })); onChanged(); toast('בית הכנסת נמחק'); }
    catch (e) { toastError(e); }
  }

  return html`<div class="page">
    <header class="page-head">
      <div><h1>בתי כנסת</h1><p class="muted">${data.synagogues.length} בתי כנסת במערכת</p></div>
      <${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>בית כנסת חדש<//>
    </header>
    <div class="toolbar">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש לפי שם, כתובת או מנהל…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${data.areas.length > 0 && html`<${Select} value=${area} onChange=${setArea} placeholder="כל האזורים" options=${data.areas.map((a) => ({ value: a.id, label: a.name }))} />`}
    </div>
    ${data.synagogues.length === 0
      ? html`<${Empty} icon="building" title="אין עדיין בתי כנסת"><div class="pad"><${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>יצירת בית הכנסת הראשון<//></div><//>`
      : html`<div class="table-wrap card"><table class="table">
          <thead><tr><th>שם</th><th>אזור</th><th>מנהלים</th><th>מניינים</th><th>הרשאות</th><th /></tr></thead>
          <tbody>${shown.map((s) => html`<tr key=${s.id}>
            <td><a class="strong" href=${`#/s/${s.id}`}>${s.name}</a>${!s.is_active && html` <${Badge} tone="warn">מוסתר<//>`}
              <div class="muted small">${s.address}</div></td>
            <td>${s.area_name || html`<span class="muted">—</span>`}</td>
            <td>${s.managers.length ? s.managers.map((m) => m.name).join(', ') : html`<${Badge} tone="warn">ללא מנהל<//>`}</td>
            <td dir="ltr" class="start"><span class="num">${s.minyanim_count}</span><span class="muted"> / ${s.settings.max_minyanim}</span></td>
            <td class="small">
              ${!s.settings.can_edit_info && html`<${Badge}>פרטים נעולים<//> `}
              ${s.settings.restrict_prayers && html`<${Badge}>תפילות מוגבלות<//>`}
              ${s.settings.can_edit_info && !s.settings.restrict_prayers && html`<span class="muted">רגיל</span>`}
            </td>
            <td class="actions">
              <${Button} kind="ghost" small icon="external" title="כניסה לבית הכנסת" onClick=${() => (location.hash = `/s/${s.id}`)} />
              <${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => setEditing(s)} />
              <${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(s)} />
            </td>
          </tr>`)}</tbody>
        </table>
        ${shown.length === 0 && html`<div class="muted pad center">אין תוצאות</div>`}</div>`}
    ${editing && html`<${SynagogueModal} synagogue=${editing === 'new' ? null : editing} data=${data}
        onClose=${() => setEditing(null)} onSaved=${saved} />`}
  </div>`;
}

function SynagogueModal({ synagogue, data, onClose, onSaved }) {
  const isNew = !synagogue;
  const st = synagogue?.settings;
  const initial = {
    name: synagogue?.name ?? '', area_id: synagogue?.area_id ?? null, address: synagogue?.address ?? '', phone: synagogue?.phone ?? '',
    notes: synagogue?.notes ?? '', is_active: synagogue?.is_active ?? true,
    can_edit_info: st?.can_edit_info ?? true, max_locations: st?.max_locations ?? 5, max_minyanim: st?.max_minyanim ?? 50,
    restrict_prayers: st?.restrict_prayers ?? false, allowed_prayer_ids: st?.allowed_prayer_ids ?? data.prayers.map((p) => p.id),
    manager_ids: synagogue?.managers.map((m) => m.id) ?? [],
  };
  const managers = data.users.filter((u) => u.role === 'manager');

  const save = (v) => {
    const body = { ...v, max_locations: Number(v.max_locations), max_minyanim: Number(v.max_minyanim), allowed_prayer_ids: v.restrict_prayers ? v.allowed_prayer_ids : [] };
    return isNew ? api.post('/admin/synagogues', body) : api.patch(`/admin/synagogues/${synagogue.id}`, body);
  };

  return html`<${FormModal} wide title=${isNew ? 'בית כנסת חדש' : `עריכת ${synagogue.name}`} initial=${initial} save=${save} onClose=${onClose}
      onSaved=${(s) => { onSaved(s, isNew); toast(isNew ? 'בית הכנסת נוצר' : 'השינויים נשמרו'); }}>
    ${({ values: v, set, errors }) => html`
      <div class="modal-cols">
        <div>
          <h4>פרטים</h4>
          <${Field} label="שם" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} required /><//>
          <div class="grid-2">
            <${Field} label="אזור" error=${errors.area_id}>
              <${Select} value=${v.area_id} onChange=${set('area_id')} placeholder="ללא אזור" options=${data.areas.map((a) => ({ value: a.id, label: a.name }))} /><//>
            <${Field} label="טלפון" error=${errors.phone}><${Input} dir="ltr" value=${v.phone} onInput=${set('phone')} /><//>
          </div>
          <${Field} label="כתובת" error=${errors.address}><${Input} value=${v.address} onInput=${set('address')} /><//>
          <${Field} label="הערות" error=${errors.notes}><${TextArea} value=${v.notes} onInput=${set('notes')} /><//>
          <${Toggle} checked=${v.is_active} onChange=${set('is_active')} label="פעיל לציבור" hint="כבוי = בית הכנסת והמניינים שלו לא מוצגים בממשק הציבורי" />
        </div>
        <div>
          <h4>מנהלי בית הכנסת</h4>
          <${Field} group label="מנהלים" error=${errors.manager_ids} hint=${managers.length ? '' : 'אין עדיין משתמשים מסוג מנהל בית כנסת. צרו אותם בעמוד המשתמשים'}>
            <${CheckList} searchable options=${managers.map((u) => ({ value: u.id, label: u.name, sub: u.email }))} value=${v.manager_ids} onChange=${set('manager_ids')} empty="אין מנהלים" /><//>
          <h4>מה מותר למנהל</h4>
          <${Toggle} checked=${v.can_edit_info} onChange=${set('can_edit_info')} label="עריכת פרטי בית הכנסת" hint="שם, כתובת, טלפון והערות" />
          <div class="grid-2">
            <${Field} label="מקסימום מניינים" error=${errors.max_minyanim}><${Input} type="number" min="0" max="1000" dir="ltr" value=${v.max_minyanim} onInput=${set('max_minyanim')} /><//>
            <${Field} label="מקסימום מיקומים" error=${errors.max_locations}><${Input} type="number" min="0" max="100" dir="ltr" value=${v.max_locations} onInput=${set('max_locations')} /><//>
          </div>
          <${Toggle} checked=${v.restrict_prayers} onChange=${set('restrict_prayers')} label="הגבלת סוגי תפילה" hint="רק התפילות שנבחרו יהיו זמינות למנהל" />
          ${v.restrict_prayers && html`<${Field} group label="תפילות מותרות" error=${errors.allowed_prayer_ids}>
            <${CheckList} options=${data.prayers.map((p) => ({ value: p.id, label: p.name }))} value=${v.allowed_prayer_ids} onChange=${set('allowed_prayer_ids')} /><//>`}
        </div>
      </div>`}
  <//>`;
}
