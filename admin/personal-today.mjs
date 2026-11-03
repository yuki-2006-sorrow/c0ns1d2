// Date-only priorities use Shanghai calendar dates supplied by the caller.
// A missing exam clock time never becomes an invented timestamp.
export function buildTodayFocus(personal,day){
 const projects=(personal.projects||[]).filter(project=>project.status==='active');
 const upcoming=projects.filter(project=>project.deadline&&project.deadline>=day)
  .map(project=>({...project,days:Math.round((Date.parse(project.deadline+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000)}))
  .filter(project=>project.days<=7).sort((a,b)=>a.deadline.localeCompare(b.deadline)||a.title.localeCompare(b.title)).slice(0,2);
 const rank=id=>{const index=upcoming.findIndex(project=>project.id===id);return index<0?2:index;};
 const tasks=(personal.tasks||[]).filter(task=>task.date===day).slice().sort((a,b)=>Number(a.done)-Number(b.done)||rank(a.projectId)-rank(b.projectId));
 return {upcoming,focus:upcoming[0]||null,tasks};
}
