// Whose name a viewer may see on a change or an answer: the super admin is never named to anyone else,
// and a synagogue manager sees any admin only as "מנהל". Everyone sees their own name.

/** who: { id, name, role, is_super } of the person who did it (is_super as stored: 0/1). */
export function shownName(viewer, who) {
  if (!who?.id) return null;
  if (viewer?.is_super || viewer?.id === who.id) return who.name;
  if (who.is_super === 1 || who.is_super === true) return 'מנהל';
  if (who.role === 'admin' && viewer?.role !== 'admin') return 'מנהל';
  return who.name;
}

/** Replaces row[nameKey] using the joined `${prefix}_id/_role/_super` columns, which are then dropped. */
export function nameRow(viewer, row, prefix, nameKey) {
  const { [`${prefix}_id`]: whoId, [`${prefix}_role`]: role, [`${prefix}_super`]: isSuper, ...rest } = row;
  return { ...rest, [nameKey]: rest[nameKey] == null ? null : shownName(viewer, { id: whoId, name: rest[nameKey], role, is_super: isSuper }) };
}
