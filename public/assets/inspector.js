(() => {
  const source = document.getElementById('snapshot-data');
  if (!source) return;
  let data = JSON.parse(source.textContent);
  const config = JSON.parse(document.getElementById('reader-config').textContent);
  const panel = document.getElementById('panel-nodes');
  panel.style.setProperty('--display-ratio', data.display.height / data.display.width);
  let fontScale = 55;
  let translated = false;
  let translatedLabels = {};
  const displayLabel = (window, node) => (translated ? translatedLabels : config.labels)[key(window,node)];
  const tree = document.getElementById('node-tree');
  const inspector = document.getElementById('node-inspector');
  const windowFilter = document.getElementById('window-filter');
  const search = document.getElementById('node-search');
  const collapsed = new Set();
  let selected = null;
  const key = (window, node) => `${window.id}:${node.id}`;
  const element = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
  const flagName = {visible: '对用户可见', enabled: '已启用', clickable: '可点击', scrollable: '可滚动', editable: '可编辑', password: '密码字段', sensitive: '敏感数据', focused: '输入焦点'};
  const selectNode = (window, node) => {
    selected = key(window, node);
    tree.querySelectorAll('.node-row').forEach(row => row.classList.toggle('selected', row.dataset.key === selected));
    inspector.replaceChildren(element('span', 'NODE PROPERTIES', 'eyebrow'), element('h3', node.class_name.split('.').pop()));
    const dl = element('dl', undefined, 'node-property-list');
    const fields = [['节点 ID', node.id], ['资源 ID', node.view_id || '未返回'], ['控件类名', node.class_name], ['父节点', node.parent_id ?? '根节点'], ['屏幕坐标', `[${node.bounds.join(', ')}]`], ['文本字段', node.text_present ? '存在 · 正文已省略' : '未记录文本'], ...Object.entries(flagName).map(([flag, name]) => [name, node.flags[flag] === null ? '未记录' : node.flags[flag] ? '是' : '否'])];
    fields.forEach(([name, value]) => { const row = element('div'); row.append(element('dt', name), element('dd', value)); dl.append(row); });
    inspector.append(dl);
  };
  const currentWindows = () => data.windows.filter(window => !windowFilter.value || window.id === windowFilter.value);
  const drawMap = () => {
    const svg = document.getElementById('node-map');
    const ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', `0 0 ${data.display.width} ${data.display.height}`);
    svg.replaceChildren();
    const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', data.display.width); bg.setAttribute('height', data.display.height); bg.setAttribute('fill', 'var(--map-bg)'); svg.append(bg);
    let labelIndex = 0;
    currentWindows().forEach((window, index) => window.nodes.forEach(node => {
      if (node.flags.visible === false) return;
      const query = search.value.trim().toLowerCase();
      if (query && !`${node.class_name} ${node.view_id || ''} ${node.id}`.toLowerCase().includes(query)) return;
      const [left, top, right, bottom] = node.bounds;
      const rect = document.createElementNS(ns, 'rect');
      Object.entries({x:left, y:top, width:Math.max(0,right-left), height:Math.max(0,bottom-top), fill:index % 2 ? '#0caaa01a' : '#5262ef0a', stroke:index % 2 ? '#0caaa0' : '#6875ef', 'stroke-width':1.2, 'vector-effect':'non-scaling-stroke'}).forEach(([name,value]) => rect.setAttribute(name,value));
      const title = document.createElementNS(ns, 'title'); title.textContent = `${node.class_name} · ${node.id}`; rect.append(title);
      rect.addEventListener('click', () => { activateTab('tree'); selectNode(window,node); tree.querySelectorAll('.node-row').forEach(row => { if(row.dataset.key === selected) row.scrollIntoView({block:'nearest'}); }); });
      svg.append(rect);
      const label = displayLabel(window, node);
      if (label) {
        const clip = document.createElementNS(ns, 'clipPath');
        clip.id = `node-label-clip-${labelIndex++}`;
        const area = document.createElementNS(ns, 'rect');
        Object.entries({x:left, y:top, width:Math.max(0,right-left), height:Math.max(0,bottom-top)}).forEach(([name,value]) => area.setAttribute(name,value));
        clip.append(area); svg.append(clip);
        const text = document.createElementNS(ns, 'text');
        Object.entries({x:left+3, y:(top+bottom)/2, 'dominant-baseline':'middle', 'font-size':20*fontScale/100*data.display.width/(Number(panel.dataset.width || 300)-2), 'clip-path':`url(#${clip.id})`, class:'map-label'}).forEach(([name,value]) => text.setAttribute(name,value));
        text.textContent = label; svg.append(text);
      }
    }));
  };
  const renderTree = () => {
    tree.replaceChildren();
    const query = search.value.trim().toLowerCase();
    let found = 0;
    currentWindows().forEach(window => {
      const header = element('div', undefined, 'tree-window');
      header.append(element('span', window.type, 'window-type'), element('small', window.package || window.id), element('span', window.root_status === 'available' ? `${window.nodes.length} 节点` : window.root_status, 'window-count'));
      tree.append(header);
      const nodes = new Map(window.nodes.map(node => [node.id, node]));
      const children = new Map();
      window.nodes.forEach(node => { const parent = node.parent_id ?? null; if(!children.has(parent)) children.set(parent,[]); children.get(parent).push(node); });
      const visibleIds = new Set();
      window.nodes.forEach(node => {
        if (!query || `${node.class_name} ${node.view_id || ''} ${node.id}`.toLowerCase().includes(query)) {
          let ancestor = node;
          while (ancestor) { visibleIds.add(ancestor.id); ancestor = nodes.get(ancestor.parent_id); }
        }
      });
      const appendNode = node => {
        if (!visibleIds.has(node.id)) return;
        found++;
        const row = element('div', undefined, 'node-row'); row.dataset.key = key(window,node); row.style.paddingLeft = `${Math.min(node.depth,12)*14+10}px`; row.classList.toggle('selected',selected===row.dataset.key);
        const hasChildren = children.has(node.id);
        if(hasChildren) { const toggle = element('button', collapsed.has(row.dataset.key) && !query ? '›' : '⌄', 'tree-toggle'); toggle.setAttribute('aria-label', `展开或收起 ${node.id}`); toggle.setAttribute('aria-expanded', String(!collapsed.has(row.dataset.key)||!!query)); toggle.addEventListener('click', () => { collapsed.has(row.dataset.key) ? collapsed.delete(row.dataset.key) : collapsed.add(row.dataset.key); renderTree(); }); row.append(toggle); }
        else row.append(element('span','·','tree-leaf'));
        const button = element('button',undefined,'node-select'); const labels = element('span',undefined,'node-label'); labels.append(element('strong',displayLabel(window,node) || node.class_name.split('.').pop()),element('small',node.view_id?.split('/').pop() || node.id)); button.append(labels);
        if(node.flags.clickable) button.append(element('span','可点击','node-flag'));
        if(node.flags.editable || node.flags.password || node.flags.sensitive) button.append(element('span','正文省略','node-flag muted'));
        button.addEventListener('click', () => selectNode(window,node)); row.append(button); tree.append(row);
        if(hasChildren && (!collapsed.has(row.dataset.key) || query)) children.get(node.id).forEach(appendNode);
      };
      (children.get(null)||[]).forEach(appendNode);
      if(!window.nodes.length) tree.append(element('p','此窗口没有节点记录。请查看 root_status 和快照概况。','node-empty'));
    });
    if(!found && query) tree.append(element('p','没有匹配的节点。','node-empty'));
    drawMap();
  };
  const activateTab = tab => {
    document.querySelectorAll('[data-node-tab]').forEach(button => { const active = button.dataset.nodeTab === tab; button.classList.toggle('active',active); button.setAttribute('aria-selected',String(active)); button.tabIndex = active ? 0 : -1; });
    ['tree','map','json'].forEach(name => document.getElementById(`node-${name}-view`).hidden = name !== tab);
  };
  document.querySelectorAll('[data-node-tab]').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.nodeTab)));
  panel.addEventListener('viewerresize', drawMap);
  document.querySelectorAll('[data-reader-font]').forEach(button => button.addEventListener('click', () => {
    fontScale = Math.max(35, Math.min(100, fontScale + Number(button.dataset.readerFont)));
    panel.style.setProperty('--reader-scale', fontScale/100);
    document.getElementById('reader-font-label').textContent = `${fontScale}%`;
    document.querySelectorAll('[data-reader-font]').forEach(control => control.disabled = Number(control.dataset.readerFont) < 0 ? fontScale === 35 : fontScale === 100);
    drawMap();
  }));
  const translationButton = document.getElementById('reader-translate');
  const message = document.getElementById('reader-message');
  const showMessage = text => { message.textContent = text; message.hidden = !text; };
  translationButton.addEventListener('click', async () => {
    showMessage('');
    if (translated) {
      translated = false; translationButton.textContent = '翻译'; translationButton.setAttribute('aria-pressed','false'); renderTree(); return;
    }
    if (!Object.keys(config.labels).length) { showMessage('此快照没有固定样例标签；节点正文保持省略。'); return; }
    translationButton.disabled = true; translationButton.textContent = '…';
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), 16000);
    try {
      const response = await fetch(config.translateUrl, {method:'POST', credentials:'same-origin', signal:aborter.signal, headers:{'Accept':'application/json','X-CSRF-TOKEN':document.querySelector('meta[name="csrf-token"]').content}});
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 419 ? '页面已过期，请刷新后重试。' : response.status === 429 ? '操作频繁，请稍后重试。' : result.errors?.translation?.[0] || result.message || '翻译请求未完成，请重试。');
      if (!result.labels || typeof result.labels !== 'object') throw new Error('翻译数据格式异常。');
      translatedLabels = result.labels; translated = true;
      translationButton.textContent = '原文'; translationButton.setAttribute('aria-pressed','true'); renderTree();
      showMessage(`已翻译 ${Object.keys(result.labels).length} 个固定样例标签`);
    } catch (error) {
      showMessage(error.name === 'AbortError' ? '翻译请求超时，请稍后重试。' : error.message);
      translationButton.textContent = '翻译';
    } finally { clearTimeout(timer); translationButton.disabled = false; }
  });
  windowFilter.addEventListener('change', () => { selected=null; renderTree(); inspector.replaceChildren(element('h3','选择一个节点')); });
  search.addEventListener('input',renderTree);
  document.getElementById('node-json').textContent = JSON.stringify(data,null,2);
  renderTree();
  activateTab('map');
  const tabs = [...document.querySelectorAll('[data-node-tab]')];
  tabs.forEach((button,index) => button.addEventListener('keydown', event => {
    const next = event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowLeft' ? (index+tabs.length-1)%tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : -1;
    if (next < 0) return;
    event.preventDefault(); activateTab(tabs[next].dataset.nodeTab); tabs[next].focus();
  }));
  const firstWindow = data.windows.find(window => window.nodes.length);
  if(firstWindow) selectNode(firstWindow,firstWindow.nodes[0]);
  window.addEventListener('diagnostic-frame', event => {
    data = event.detail.payload;
    config.labels = {}; translated = false; translatedLabels = {}; selected = null; collapsed.clear();
    translationButton.textContent = '翻译'; translationButton.setAttribute('aria-pressed', 'false');
    windowFilter.replaceChildren(new Option(`全部窗口（${data.windows.length}）`, ''));
    data.windows.forEach(item => windowFilter.add(new Option(`${item.type} · ${item.package || item.id}`, item.id)));
    panel.style.setProperty('--display-ratio', data.display.height / data.display.width);
    document.querySelector('.reader-count').textContent = `#${data.windows.reduce((total, item) => total + item.nodes.length, 0)}`;
    document.querySelector('#panel-screenshot .panel-counter').textContent = `#${event.detail.id}`;
    const img = document.getElementById('screen-image');
    if (img) { img.hidden = !event.detail.image_url; if (event.detail.image_url) img.src = event.detail.image_url; else img.removeAttribute('src'); }
    document.getElementById('node-json').textContent = JSON.stringify(data, null, 2);
    inspector.replaceChildren(element('h3','选择一个节点'));
    renderTree();
    if (document.getElementById('debug-workspace').hidden) window.dispatchEvent(new CustomEvent('viewer-open'));
  });
  window.addEventListener('diagnostic-clear', () => {
    data = {...data, windows: []}; config.labels = {}; translatedLabels = {};
    const img = document.getElementById('screen-image');
    if (img) { img.removeAttribute('src'); img.hidden = true; }
    windowFilter.replaceChildren(new Option('会话已结束', ''));
    document.getElementById('node-json').textContent = '{}';
    inspector.replaceChildren(element('h3','诊断会话已结束'));
    renderTree();
  });
})();
