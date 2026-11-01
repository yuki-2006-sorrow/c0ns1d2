document.querySelector('.cinema-entrances')?.addEventListener('click',event=>event.stopPropagation());
document.addEventListener('click',event=>document.querySelectorAll('.archive-account[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.archive-account[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});});
const search=document.getElementById('bridge-search');
search?.addEventListener('input',()=>{
  const query=search.value.trim().toLocaleLowerCase();let count=0;
  document.querySelectorAll('[data-memory-row]').forEach(row=>{row.hidden=!row.textContent.toLocaleLowerCase().includes(query);if(!row.hidden)count++;});
  document.querySelectorAll('.memory-year').forEach(year=>year.hidden=![...year.querySelectorAll('[data-memory-row]')].some(row=>!row.hidden));
  document.getElementById('bridge-no-results').hidden=count>0||!query;
});
document.querySelectorAll('#siteNav a').forEach(link=>{if(link.getAttribute('href')?.endsWith('/events')&&location.pathname.endsWith('/timeline'))link.setAttribute('aria-current','page');});
document.addEventListener('error',event=>{
  const img=event.target;
  if(!(img instanceof HTMLImageElement)||!img.getAttribute('src')||img.nextElementSibling?.classList.contains('photo-retry'))return;
  const retry=document.createElement('button');retry.type='button';retry.className='photo-retry';retry.textContent='照片未能载入 · 点击重试';
  retry.onclick=event=>{event.preventDefault();event.stopPropagation();retry.remove();const src=img.src;img.removeAttribute('src');img.src=src;};
  img.after(retry);
},true);
