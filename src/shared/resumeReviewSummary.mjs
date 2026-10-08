/** Summarize validated proposals; absence of a proposal is never a quality guarantee. */
export function resumeReviewSummary(analysis,sections,doneIds=[]) {
 const kinds=[['experience','Experience'],['skills','Technical Skills'],['project','Projects']];
 return kinds.map(([kind,label])=>{
   const changes=analysis.suggestions.filter(s=>kind==='skills'?s.kind==='skills':s.kind==='section'&&sections[s.si]?.kind===kind);
   const pending=changes.filter(c=>!doneIds.includes(c.id));
   const reviewed=changes.length-pending.length;
   const rejected=(analysis.rejected||[]).filter(r=>kind==='skills'?r.section==='Technical Skills':sections.some(s=>s.kind===kind&&s.role===r.section));
   const reasons=rejected.map(r=>/missing requirement/i.test(r.reason)?'The proposed rewrite targeted a requirement without confirmed evidence.':/Unsupported skill/i.test(r.reason)?'A proposed skill could not be verified against approved evidence.':/and|comma|word|verb|technolog|punctuation/i.test(r.reason)?'The proposed wording did not meet your bullet-writing rules.':'A proposal did not pass evidence validation.');
   return {kind,label,count:pending.length,reviewed,blocked:rejected.length,status:pending.length?'Changes ready':reviewed?'Reviewed':rejected.length?'Changes blocked':'Current wording kept',explanation:pending.length?`${pending.length} validated ${pending.length===1?'change is':'changes are'} ready to review.`:reviewed?'No pending changes remain for this section.':rejected.length?'Your current content is kept because the proposals did not pass validation.':'No validated changes were returned. This does not mean the section is perfect.',reasons:[...new Set(reasons)]};
 });
}
