(() => {
  const root = document.getElementById('diagnostic-controls');
  if (!root) return;
  const base = root.dataset.base;
  const status = document.getElementById('diagnostic-status');
  const start = document.getElementById('diagnostic-connect');
  const stop = document.getElementById('diagnostic-stop');
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const viewer = crypto.randomUUID();
  let session = null, timer, generation = 0, renewed = 0, sequence = -1, leased = false;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(path, {method, credentials:'same-origin', signal:AbortSignal.timeout(6000), headers:{Accept:'application/json', 'Content-Type':'application/json', 'X-CSRF-TOKEN':csrf}, ...(body ? {body:JSON.stringify(body)} : {})});
    if (!response.ok) throw new Error(response.status === 409 ? '会话已结束、等待超时或由其他页面查看。' : '诊断连接未完成，请核对会话与网络。');
    return response.json();
  };
  const end = (message = '诊断已停止。') => {
    const previous = leased ? session : null; session = null; leased = false; generation++; clearTimeout(timer);
    start.disabled = false; stop.disabled = true; status.textContent = message;
    window.dispatchEvent(new CustomEvent('diagnostic-clear'));
    if (previous) fetch(`${base}/${previous}/stop`, {method:'POST', keepalive:true, credentials:'same-origin', headers:{Accept:'application/json','X-CSRF-TOKEN':csrf}}).catch(() => {});
  };
  const tick = async (run) => {
    if (!session || run !== generation) return;
    const id = session;
    try {
      if (performance.now() - renewed >= 2500) {
        await request(`${base}/${id}/lease`, 'POST', {viewer_id:viewer});
        if (run !== generation) return;
        leased = true;
        renewed = performance.now();
      }
      const result = await request(`${base}/${id}/preview`);
      if (run !== generation) return;
      status.textContent = result.frame ? `诊断中 · 第 ${result.state.last_sequence} 帧` : '会话已连接，等待客户端提交截图 / 节点。';
      if (result.frame && result.state.last_sequence !== sequence) {
        sequence = result.state.last_sequence;
        window.dispatchEvent(new CustomEvent('diagnostic-frame', {detail:result.frame}));
      }
      timer = setTimeout(() => tick(run), 1000);
    } catch (error) { if (run === generation) end(error.message); }
  };
  start.addEventListener('click', async () => {
    start.disabled = true; status.textContent = '正在检查手机端会话…';
    const run = ++generation;
    try {
      const result = await request(base);
      if (run !== generation) return;
      if (!result.session || !['waiting','active'].includes(result.session.status)) throw new Error('请先在手机端开启新的诊断会话；当前 APK 的采集模块尚未接入。');
      session = result.session.session_id; stop.disabled = false; renewed = -Infinity; sequence = -1;
      await tick(run);
    } catch (error) { if (run === generation) end(error.message); }
  });
  stop.addEventListener('click', () => end());
  window.addEventListener('pagehide', () => end());
  window.addEventListener('viewer-visibility', event => {
    if (session && !event.detail.visible) end();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) end('已离开诊断页面，采集会话停止。'); });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-all-panels]')) end();
    if (event.target.closest('[data-close-panel]')) requestAnimationFrame(() => {
      if (session && [...document.querySelectorAll('.debug-panel')].every(panel => panel.hidden)) end();
    });
  });
})();
