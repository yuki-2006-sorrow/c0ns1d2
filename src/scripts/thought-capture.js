document.querySelectorAll('.thought-capture').forEach(root => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  const open = root.querySelector('.capture-open'), dialog = root.querySelector('dialog'), form = root.querySelector('form');
  const body = form.elements.body, title = form.elements.title, target = form.querySelector('select'), search = form.querySelector('[type="search"]');
  const status = root.querySelector('.capture-status'), submit = form.querySelector('[type="submit"]'), close = root.querySelector('.capture-close');
  let busy = false;
  let choices = [];
  fetch('/api/build-status').then(response => { if (response.ok) open.hidden = false; }).catch(() => {});
  const draw = () => {
    const selected = target.value;
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    target.replaceChildren(new Option('暂时不关联', ''));
    choices.filter(entry => words.every(word => entry.title.toLowerCase().includes(word)) || `${entry.type}:${entry.id}` === selected).forEach(entry => target.add(new Option(entry.title, `${entry.type}:${entry.id}`)));
    target.value = selected;
  };
  open.addEventListener('click', async () => {
    dialog.showModal(); body.focus();
    try {
      const [events, works] = await Promise.all([fetch('/api/events').then(response => response.json()), fetch('/api/works').then(response => response.json())]);
      choices = [...events.map(entry => ({type:'event', id:entry.slug, title:`记忆 · ${entry.title}${entry.draft ? '（草稿）' : ''}`})), ...works.map(entry => ({type:'work', id:entry.id, title:`作品 · ${entry.title}${entry.draft ? '（草稿）' : ''}`}))].filter(entry => entry.type !== root.dataset.type || entry.id !== root.dataset.entry);
      draw();
    } catch { status.textContent = '暂时读不到引用列表，可以先记下文字'; }
  });
  search.addEventListener('input', draw);
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  window.addEventListener('beforeunload', event => { if (body.value.trim() || title.value.trim() || target.value) { event.preventDefault(); event.returnValue = ''; } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if (!body.value.trim() && !title.value.trim() && !target.value) { status.textContent = '先记下一点想法'; body.focus(); return; }
    busy = true; submit.disabled = true; close.disabled = true; status.textContent = '正在记录…';
    const controls = [body, title, target, search]; controls.forEach(control => { control.disabled = true; });
    try {
      const separator = target.value.indexOf(':');
      const response = await fetch('/api/association', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fromType:root.dataset.type, fromId:root.dataset.entry, title:title.value, body:body.value, toType:separator < 0 ? '' : target.value.slice(0,separator), toId:separator < 0 ? '' : target.value.slice(separator + 1), draft:true})});
      const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || '记录失败');
      body.value = ''; title.value = ''; target.value = ''; status.replaceChildren(document.createTextNode('已记为草稿。'));
      const link = document.createElement('a'); link.textContent = '在后台继续写 ↗'; link.href = '/admin?' + new URLSearchParams({from:root.dataset.type, entry:root.dataset.entry, thought:result.id}); link.target = '_blank'; link.rel = 'noopener'; status.append(link);
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; submit.disabled = false; close.disabled = false; controls.forEach(control => { control.disabled = false; }); }
  });
});
