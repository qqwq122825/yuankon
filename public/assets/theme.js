(() => { try { document.documentElement.dataset.bsTheme = localStorage.getItem('boundary-theme') === 'dark' ? 'dark' : 'light'; } catch { document.documentElement.dataset.bsTheme = 'light'; } })();
