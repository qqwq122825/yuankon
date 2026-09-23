(() => {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.bsTheme = next;
    try { localStorage.setItem('boundary-theme', next); } catch { /* Optional preference storage. */ }
  });
  document.querySelectorAll('tr[data-href]').forEach(row => {
    row.addEventListener('click', event => {
      if (!event.target.closest('a,button,input,select,label') && !window.getSelection()?.toString()) location.assign(row.dataset.href);
    });
  });

})();

// Workbench navigation only switches local views; it never sends device commands.
(() => {
  const sections = [...document.querySelectorAll('[data-workbench-section]')];
  const navigation = [...document.querySelectorAll('[data-workbench-view]')];
  const activate = (name, scenario = '', updateHash = true) => {
    if (!sections.some(section => section.dataset.workbenchSection === name)) return;
    sections.forEach(section => { section.hidden = section.dataset.workbenchSection !== name; });
    navigation.forEach(button => {
      const active = button.dataset.workbenchView === name && (button.dataset.scenario || '') === scenario;
      if (button.closest('.device-nav')) {
        button.classList.toggle('active', active);
        active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
      }
    });
    if (name === 'observations') {
      document.getElementById('observation-heading').textContent = scenario === 'password' ? '密码字段事件' : '短信可见性观察';
      const rows = [...document.querySelectorAll('[data-observation-scenario]')];
      rows.forEach(row => { row.hidden = !row.dataset.observationScenario.startsWith(scenario); });
      document.getElementById('observation-filter-empty').hidden = !rows.length || rows.some(row => !row.hidden);
    }
    if (updateHash) history.replaceState(null, '', `#${scenario || name}`);
  };
  navigation.forEach(button => button.addEventListener('click', () => activate(button.dataset.workbenchView, button.dataset.scenario || '')));
  const fromHash = () => {
    const hash = location.hash.slice(1);
    if (['sms', 'password'].includes(hash)) activate('observations', hash, false);
    else activate(hash || 'overview', '', false);
  };
  if (sections.length) { fromHash(); window.addEventListener('hashchange', fromHash); }

  const selectAll = document.getElementById('select-all-devices');
  const checkboxes = [...document.querySelectorAll('.device-checkbox')];
  const updateSelection = () => {
    const count = checkboxes.filter(box => box.checked).length;
    checkboxes.forEach(box => box.closest('tr').classList.toggle('is-selected', box.checked));
    selectAll.checked = count > 0 && count === checkboxes.length;
    selectAll.indeterminate = count > 0 && count < checkboxes.length;
    const label = document.getElementById('selection-count');
    label.textContent = `已选 ${count} 台`;
    label.hidden = count === 0;
  };
  if (selectAll) {
    selectAll.addEventListener('change', () => { checkboxes.forEach(box => { box.checked = selectAll.checked; }); updateSelection(); });
    checkboxes.forEach(box => box.addEventListener('change', updateSelection));
  }
})();
