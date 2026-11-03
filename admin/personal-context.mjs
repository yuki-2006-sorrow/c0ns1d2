// Shared by the request builder and its visible preview. Never include records,
// device credentials, AI configuration, or unrelated project data.
export function buildPersonalContext(personal,projectId,{includeBackground=false,includeResources=false}={}){
  const result={};
  if(includeBackground){
    result.background={};
    for(const key of ['focus','goals','about','availability','skills','constraints']){
      const value=personal.profile?.[key];if(typeof value==='string'&&value.trim())result.background[key]=value.slice(0,1500);
    }
  }
  if(includeBackground&&(personal.timetables||[]).length){result.timetables=personal.timetables.slice(-2).map(table=>({schoolYear:table.schoolYear,term:table.term,importedAt:table.importedAt,limitations:table.limitations,courses:table.courses.map(course=>({code:course.code,name:course.name,terms:course.terms,sessions:course.sessions.map(({term,weekday,periods})=>({term,weekday,periods}))}))}));}
  if(includeResources){
    const eligible=(personal.resources||[]).filter(resource=>resource.shareWithAI===true&&resource.status==='available'&&(!resource.projectId||resource.projectId===projectId));
    result.resources=eligible.slice(0,20).map(resource=>({title:resource.title,kind:resource.kind,detail:resource.detail.slice(0,800)}));
    if(eligible.length>20)result.omittedResourceCount=eligible.length-20;
  }
  if(includeResources){const docs=(personal.documents||[]).filter(doc=>doc.shareWithAI&&!doc.stale&&(!doc.projectId||doc.projectId===projectId));result.documents=docs.slice(-5).map(doc=>({name:doc.name,source:doc.sourceName,updatedAt:doc.updatedAt,excerpt:doc.text.slice(0,4000),excerptTruncated:doc.text.length>4000}));}
  if(includeResources)result.opportunities=(personal.notices||[]).filter(notice=>notice.relevant).slice(0,6).map(({title,published,url,source})=>({title,published,url,source}));
  return result;
}
