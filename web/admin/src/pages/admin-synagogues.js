import { api } from '../api.js';
import { html, navigate, norm, pluralize, useEffect, useMemo, useState } from '../lib.js';
import {
  Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Icon, Input, Pager, Select, Spinner, TextArea, Toggle,
  confirm, toast, toastError, useLoad,
} from '../ui.js';

const PAGE = 50;
const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

export function AdminSynagogues({ onChanged, perms = [] }) {
  const { data, error, loading, reload, setData } = useLoad(() =>
    Promise.all([api.get('/admin/synagogues'), api.get('/admin/catalog/areas'), api.get('/admin/catalog/prayers')])
      .then(([synagogues, areas, prayers]) => ({ synagogues, areas, prayers }))
  );
  const [q, setQ] = useState('');
  const [area, setArea] = useState(null);
  const [status, setStatus] = useState(() => (query().get('filter') === 'unmanaged' ? 'unmanaged' : 'all'));
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null); // null | 'new' | synagogue
  // #/admin/synagogues?edit=ID opens the settings of one synagogue (from its screen)
  useEffect(() => {
    const id = Number(query().get('edit'));
    if (id && data) { const s = data.synagogues.find((x) => x.id === id); if (s) setEditing(s); }
  }, [data]);
  useEffect(() => setPage(0), [q, area, status]);

  const shown = useMemo(() => (data?.synagogues || []).filter((s) =>
    (area === null || s.area_id === area) &&
    (status === 'all' || (status === 'active' ? s.is_active : status === 'hidden' ? !s.is_active : s.managers.length === 0)) &&
    (!q || norm(`${s.name} ${s.address} ${s.managers.map((m) => m.name).join(' ')}`).includes(norm(q)))), [data, q, area, status]);

  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const saved = (s, isNew) => {
    setData((d) => ({ ...d, synagogues: isNew ? [...d.synagogues, s].sort((a, b) => a.name.localeCompare(b.name, 'he')) : d.synagogues.map((x) => (x.id === s.id ? { ...x, ...s } : x)) }));
    onChanged();
    if (isNew) navigate(`/s/${s.id}`);
  };
  const closeEdit = () => { setEditing(null); if (query().get('edit')) history.replaceState(null, '', '#/admin/synagogues'); };

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

  const unmanaged = data.synagogues.filter((s) => !s.managers.length).length;
  const pageItems = shown.slice(page * PAGE, (page + 1) * PAGE);
  return html`<div class="page">
    <header class="page-head">
      <div><h1>בתי כנסת</h1><p class="muted">${pluralize(data.synagogues.length, 'בית כנסת', 'בתי כנסת')} במערכת${unmanaged ? ` · ${unmanaged} בלי גבאי` : ''}</p></div>
      ${perms.includes('synagogues') && html`<${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>בית כנסת חדש<//>`}
    </header>
    <div class="toolbar filters">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש לפי שם, כתובת או גבאי…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${data.areas.length > 0 && html`<${Select} value=${area} onChange=${setArea} placeholder="כל האזורים" options=${data.areas.map((a) => ({ value: a.id, label: a.name }))} />`}
      <${Select} value=${status} onChange=${setStatus} options=${[{ value: 'all', label: 'כל המצבים' }, { value: 'active', label: 'מוצגים לציבור' }, { value: 'hidden', label: 'מוסתרים' }, { value: 'unmanaged', label: 'בלי גבאי' }]} />
    </div>
    ${data.synagogues.length === 0
      ? html`<${Empty} icon="building" title="אין עדיין בתי כנסת">${perms.includes('synagogues') && html`<div class="pad"><${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>יצירת בית הכנסת הראשון<//></div>`}<//>`
      : html`<div class="card table-wrap"><table class="table responsive">
          <thead><tr><th>בית הכנסת</th><th>אזור</th><th>גבאים</th><th>מניינים</th><th>הגדרות</th><th /></tr></thead>
          <tbody>${pageItems.map((s) => html`<tr key=${s.id} class=${s.is_active ? '' : 'inactive'}>
            <td data-label="בית הכנסת"><a class="strong" href=${`#/s/${s.id}`}>${s.name}</a>${!s.is_active && html` <${Badge} tone="warn">מוסתר<//>`}
              <div class="muted small">${s.address}</div></td>
            <td data-label="אזור">${s.area_name || html`<span class="muted">—</span>`}</td>
            <td data-label="גבאים">${s.managers.length ? html`<span class="ellipsis-2">${s.managers.map((m) => m.name).join(', ')}</span>` : html`<${Badge} tone="warn">ללא גבאי<//>`}</td>
            <td data-label="מניינים"><span class="num">${s.minyanim_count}</span>${s.settings.max_minyanim ? html`<span class="muted"> / ${s.settings.max_minyanim}</span>` : ''}</td>
            <td data-label="הגדרות" class="small">
              ${s.settings.editable_fields.length > 0 && html`<${Badge} tone="info">עריכת ${s.settings.editable_fields.length} פרטים<//> `}
              ${s.settings.restrict_prayers && html`<${Badge}>תפילות מוגבלות<//> `}
              ${s.settings.allow_interval && html`<${Badge}>שטיבלאך<//> `}
              ${s.settings.allow_other_seasons && html`<${Badge}>כל העונות<//>`}
              ${!s.settings.editable_fields.length && !s.settings.restrict_prayers && !s.settings.allow_interval && !s.settings.allow_other_seasons && html`<span class="muted">רגיל</span>`}
            </td>
            <td class="actions">
              <a class="btn btn-secondary btn-sm" href=${`#/s/${s.id}`}>כניסה</a>
              ${perms.includes('synagogues') && html`<${Button} kind="ghost" small icon="settings" title="הגדרות" onClick=${() => setEditing(s)} />`}
              ${perms.includes('synagogues_delete') && html`<${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(s)} />`}
            </td>
          </tr>`)}</tbody>
        </table>
        ${shown.length === 0 && html`<div class="muted pad center">אין תוצאות</div>`}
        <${Pager} page=${page} pageSize=${PAGE} total=${shown.length} onPage=${setPage} /></div>`}
    ${editing && html`<${SynagogueModal} synagogue=${editing === 'new' ? null : editing} data=${data}
        onClose=${closeEdit} onSaved=${saved} />`}
  </div>`;
}

function SynagogueModal({ synagogue, data, onClose, onSaved }) {
  const isNew = !synagogue;
  const st = synagogue?.settings;
  const initial = {
    name: synagogue?.name ?? '', area_id: synagogue?.area_id ?? data.areas[0]?.id ?? null, address: synagogue?.address ?? '', phone: synagogue?.phone ?? '',
    notes: synagogue?.notes ?? '', is_active: synagogue?.is_active ?? true,
    editable_fields: st?.editable_fields ?? [], max_locations: st?.max_locations ?? 0, max_minyanim: st?.max_minyanim ?? 0,
    restrict_prayers: st?.restrict_prayers ?? false, allow_other_seasons: st?.allow_other_seasons ?? false, allow_interval: st?.allow_interval ?? false, allowed_prayer_ids: st?.allowed_prayer_ids ?? data.prayers.map((p) => p.id),
  };

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
              <${Select} value=${v.area_id} onChange=${set('area_id')} placeholder=${data.areas.length ? undefined : 'הגדירו קודם אזורים'} options=${data.areas.map((a) => ({ value: a.id, label: a.name }))} required /><//>
            <${Field} label="טלפון" error=${errors.phone}><${Input} dir="ltr" value=${v.phone} onInput=${set('phone')} /><//>
          </div>
          <${Field} label="כתובת" error=${errors.address}><${Input} value=${v.address} onInput=${set('address')} /><//>
          <${Field} label="הערות" error=${errors.notes}><${TextArea} value=${v.notes} onInput=${set('notes')} /><//>
          <${Toggle} checked=${v.is_active} onChange=${set('is_active')} label="פעיל לציבור" hint="כבוי = בית הכנסת והמניינים שלו לא מוצגים בממשק הציבורי" />
          ${isNew && html`<p class="muted small">אחרי השמירה בית הכנסת ייפתח, ושם מוסיפים גבאים (לשונית "גבאים") ומניינים.</p>`}
        </div>
        <div>
          <h4>מה מותר לגבאי בית הכנסת</h4>
          <${Field} group label="פרטים שהגבאי יכול לערוך" hint="כל השאר נעול. ברירת מחדל: הכל נעול">
            <${CheckList} options=${[['name', 'שם'], ['area_id', 'אזור'], ['address', 'כתובת'], ['phone', 'טלפון'], ['notes', 'הערות']].map(([value, label]) => ({ value, label }))}
              value=${v.editable_fields} onChange=${set('editable_fields')} /><//>
          <div class="grid-2">
            <${Field} label="מקסימום מניינים" hint="0 = ללא הגבלה" error=${errors.max_minyanim}><${Input} type="number" min="0" max="10000" dir="ltr" value=${v.max_minyanim} onInput=${set('max_minyanim')} /><//>
            <${Field} label="מקסימום מיקומים" hint="0 = ללא הגבלה" error=${errors.max_locations}><${Input} type="number" min="0" max="1000" dir="ltr" value=${v.max_locations} onInput=${set('max_locations')} /><//>
          </div>
          <${Toggle} checked=${v.allow_other_seasons} onChange=${set('allow_other_seasons')} label="עדכון עונות אחרות" hint="כבוי: הגבאי מעדכן רק את זמני העונה הנוכחית" />
          <${Toggle} checked=${v.allow_interval} onChange=${set('allow_interval')} label="מניינים בסבב (שטיבלאך)" hint="מניין כל כמה דקות בטווח שעות" />
          <${Toggle} checked=${v.restrict_prayers} onChange=${set('restrict_prayers')} label="הגבלת סוגי תפילה" hint="רק התפילות שנבחרו יהיו זמינות לגבאי" />
          ${v.restrict_prayers && html`<${Field} group label="תפילות מותרות" error=${errors.allowed_prayer_ids}>
            <${CheckList} options=${data.prayers.map((p) => ({ value: p.id, label: p.name }))} value=${v.allowed_prayer_ids} onChange=${set('allowed_prayer_ids')} /><//>`}
        </div>
      </div>`}
  <//>`;
}
