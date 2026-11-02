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
  if(includeResources){
    const eligible=(personal.resources||[]).filter(resource=>resource.shareWithAI===true&&resource.status==='available'&&(!resource.projectId||resource.projectId===projectId));
    result.resources=eligible.slice(0,20).map(resource=>({title:resource.title,kind:resource.kind,detail:resource.detail.slice(0,800)}));
    if(eligible.length>20)result.omittedResourceCount=eligible.length-20;
  }
  return result;
}
