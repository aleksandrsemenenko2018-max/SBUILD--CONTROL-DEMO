const labels = { floor: 'Поверх', room: 'Приміщення', segment: 'Сегмент' };
const segments = [...'ABCDEFG'];

function replaceOptions(select, rows, emptyLabel) {
  const previous = select.value;
  select.replaceChildren(...(emptyLabel ? [new Option(emptyLabel, '')] : []),
    ...rows.map(row => new Option(row.name, row.id)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

export function mountZoneHierarchy({ sb, panel, getState }) {
  const project = panel.querySelector('#zoneHierarchyProject');
  const form = panel.querySelector('#zoneHierarchyForm');
  const list = panel.querySelector('#zoneHierarchyList');
  const feedback = panel.querySelector('#zoneHierarchyStatus');
  const editId = form.elements.zone_id;
  const kind = form.elements.kind;
  const parent = form.elements.parent_id;
  const name = form.elements.name;
  const segment = form.elements.segment;
  const cancelEdit = panel.querySelector('#zoneHierarchyCancel');
  const submit = form.querySelector('button[type="submit"]');
  let zones = [];
  let generation = 0;

  function updateFields() {
    const parentKind = { room: 'floor', segment: 'room' }[kind.value];
    const floorNames = new Map(zones.filter(zone => zone.kind === 'floor').map(zone => [zone.id, zone.name]));
    const candidates = zones.filter(zone => zone.kind === parentKind).map(zone => ({
      id: zone.id,
      name: zone.kind === 'room' ? floorNames.get(zone.parent_id) + ' / ' + zone.name : zone.name,
    }));
    replaceOptions(parent, candidates, 'Оберіть батьківську зону');

    const editing = !!editId.value;
    kind.disabled = editing;
    parent.disabled = editing || !parentKind;
    parent.required = !!parentKind && !editing;
    parent.closest('label').classList.toggle('hidden', !parentKind);
    name.disabled = kind.value === 'segment';
    name.required = !name.disabled;
    name.closest('label').classList.toggle('hidden', name.disabled);
    segment.disabled = !name.disabled;
    segment.required = !segment.disabled;
    segment.closest('label').classList.toggle('hidden', segment.disabled);
    const usedSegments = new Set(zones.filter(zone =>
      zone.kind === 'segment' && zone.parent_id === parent.value && zone.id !== editId.value).map(zone => zone.name));
    replaceOptions(segment, segments.filter(value => !usedSegments.has(value)).map(value => ({ id: value, name: value })),
      'Оберіть сегмент A–G');
    cancelEdit.classList.toggle('hidden', !editing);
    submit.textContent = editing ? 'Зберегти назву' : 'Додати зону';
  }

  function resetEditor() {
    form.reset();
    editId.value = "";
    updateFields();
  }

  function reset() {
    generation += 1;
    panel.open = false;
    zones = [];
    resetEditor();
    project.replaceChildren();
    list.replaceChildren();
    form.classList.add('hidden');
    feedback.textContent = '';
  }

  function edit(zone) {
    editId.value = zone.id;
    kind.value = zone.kind;
    updateFields();
    parent.value = zone.parent_id || '';
    updateFields();
    name.value = zone.name;
    segment.value = zone.kind === 'segment' ? zone.name : '';
    (name.disabled ? segment : name).focus();
  }

  function render(manager) {
    const children = new Map();
    for (const zone of zones.filter(zone => zone.kind)) {
      const group = children.get(zone.parent_id) || [];
      group.push(zone);
      children.set(zone.parent_id, group);
    }
    function branch(parentId) {
      const group = document.createElement('ul');
      for (const zone of children.get(parentId) || []) {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = labels[zone.kind] + ' · ' + zone.name;
        row.append(label);
        if (manager) {
          const rename = document.createElement('button');
          rename.type = 'button';
          rename.textContent = 'Перейменувати';
          rename.setAttribute('aria-label', 'Перейменувати ' + zone.name);
          rename.addEventListener('click', () => edit(zone));
          row.append(' ', rename);
        }
        if (children.has(zone.id)) row.append(branch(zone.id));
        group.append(row);
      }
      return group;
    }

    list.replaceChildren();
    if (children.has(null)) list.append(branch(null));
    const legacy = zones.filter(zone => !zone.kind);
    if (legacy.length) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Існуючі зони без типу';
      const items = document.createElement('ul');
      for (const zone of legacy) {
        const row = document.createElement('li');
        row.textContent = zone.name;
        items.append(row);
      }
      details.append(summary, items);
      list.append(details);
    }
  }

  async function load() {
    const request = ++generation;
    const { user, profile, projects } = getState();
    form.classList.add('hidden');
    list.replaceChildren();
    feedback.textContent = '';
    if (!user || !profile?.active || !projects.length) {
      project.replaceChildren();
      feedback.textContent = 'Немає доступних об’єктів.';
      return;
    }
    const manager = ['owner', 'foreman'].includes(profile.role);
    replaceOptions(project, projects);
    feedback.textContent = 'Завантаження…';
    try {
      const { data, error } = await sb.from('sbuild_zones')
        .select('id,name,parent_id,kind').eq('project_id', project.value).order('name');
      if (request !== generation) return;
      if (error) {
        feedback.textContent = 'Структура об’єкта недоступна: ' + error.message;
        return;
      }
      zones = data || [];
      resetEditor();
      render(manager);
      form.classList.toggle('hidden', !manager);
      feedback.textContent = zones.length ? '' : 'Об’єкт не має зон.';
    } catch {
      if (request === generation) feedback.textContent = 'Не вдалося завантажити структуру об’єкта.';
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const projectId = project.value;
    const actor = getState().user?.id;
    if (!actor || !projectId) return;
    const zoneName = (kind.value === 'segment' ? segment.value : name.value).trim();
    if (!zoneName) {
      feedback.textContent = 'Введіть назву зони.';
      return;
    }
    submit.disabled = true;
    try {
      const { data, error } = editId.value
        ? await sb.from('sbuild_zones').update({ name: zoneName })
          .eq('project_id', projectId).eq('id', editId.value).select('id')
        : await sb.from('sbuild_zones').insert({
          name: zoneName, project_id: projectId, kind: kind.value, parent_id: parent.value || null,
        }).select('id');
      if (project.value !== projectId || getState().user?.id !== actor) return;
      if (error || !data?.length) {
        feedback.textContent = error?.message || 'Зона недоступна для збереження.';
        return;
      }
      await load();
      if (!feedback.textContent) feedback.textContent = 'Зону збережено.';
    } catch {
      if (project.value === projectId && getState().user?.id === actor) {
        feedback.textContent = 'Не вдалося зберегти зону.';
      }
    } finally {
      submit.disabled = false;
    }
  });

  cancelEdit.addEventListener('click', resetEditor);
  kind.addEventListener('change', updateFields);
  parent.addEventListener('change', updateFields);
  project.addEventListener('change', load);
  panel.addEventListener('toggle', () => { if (panel.open) load(); });
  panel.querySelector('#zoneHierarchyReload').addEventListener('click', load);
  return { reset };
}
