document.querySelector('.cinema-entrances')?.addEventListener('click',event=>event.stopPropagation());
const search=document.getElementById('bridge-search');
search?.addEventListener('input',()=>{
  const query=search.value.trim().toLocaleLowerCase();let count=0;
  document.querySelectorAll('[data-memory-row]').forEach(row=>{row.hidden=!row.textContent.toLocaleLowerCase().includes(query);if(!row.hidden)count++;});
  document.querySelectorAll('.memory-year').forEach(year=>year.hidden=![...year.querySelectorAll('[data-memory-row]')].some(row=>!row.hidden));
  document.getElementById('bridge-no-results').hidden=count>0||!query;
});
document.querySelectorAll('#siteNav a').forEach(link=>{if(link.getAttribute('href')?.endsWith('/events')&&location.pathname.endsWith('/timeline'))link.setAttribute('aria-current','page');});
const thoughtForm=document.getElementById('bridge-thought-form');
let dirty=false,saving=false,saved=false;
thoughtForm?.addEventListener('input',()=>{dirty=true;saved=false;if(!saving)thoughtForm.querySelector('button').disabled=false;});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
thoughtForm?.addEventListener('submit',async event=>{
  event.preventDefault();const button=thoughtForm.querySelector('button'),status=document.getElementById('bridge-note-status'),body=document.getElementById('bridge-note').value;
  if(!body.trim()||saving||saved)return;saving=true;button.disabled=true;document.getElementById('bridge-note').readOnly=true;status.textContent='正在保存…';
  try{
    const response=await fetch('/api/entry',{method:'POST',headers:{'Content-Type':'application/json','X-Archive-Client':'1'},body:JSON.stringify({type:'thought',title:'',body,date:'?',fromId:thoughtForm.dataset.origin,toId:'',scope:'private',published:false,recipients:[],images:[],videos:[]})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'保存失败');
    status.textContent='已存为仅自己可见的草稿。';const link=document.createElement('a');link.href='/shared?edit='+encodeURIComponent(result.id);link.textContent='继续整理或选择分享对象 →';status.append(link);dirty=false;saved=true;
  }catch(error){status.textContent=error.message+'。当前文字仍保留在这里。';}finally{saving=false;document.getElementById('bridge-note').readOnly=false;button.disabled=saved;}
});
