import { loadSkills } from './ac-jd-skills.mjs';
import { checkText } from './resume-builder.mjs';
import { openingVerb } from './ac-bullet-rules.mjs';
const numeric = t => [...String(t).matchAll(/\d+(?:[.,]\d+)*(?:[KkMm]|%)?\+?/g)].map(m=>m[0].toLowerCase());
export function validateSchema(schema,value,path='output') {
  if(schema.enum&&!schema.enum.includes(value))throw Error(`${path}: invalid choice`);
  if(schema.type==='object') {
    if(!value||Array.isArray(value)||typeof value!=='object')throw Error(`${path}: expected object`);
    for(const k of schema.required||[])if(!(k in value))throw Error(`${path}: missing ${k}`);
    for(const [k,v]of Object.entries(value)){if(!schema.properties[k]){if(schema.additionalProperties===false)throw Error(`${path}: forbidden field ${k}`);}else validateSchema(schema.properties[k],v,`${path}.${k}`);}
  } else if(schema.type==='array') {if(!Array.isArray(value)||value.length>(schema.maxItems||100))throw Error(`${path}: invalid list`);for(const v of value)validateSchema(schema.items,v,path);}
  else if(schema.type==='string'&&(typeof value!=='string'||value.length>(schema.maxLength||2000)))throw Error(`${path}: invalid text`);
  else if(schema.type==='integer'&&(!Number.isInteger(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw Error(`${path}: invalid number`);
}
export function buildEvidence(sections,skills,bank) {
  const entries = [];
  sections.forEach((s,si)=>s.bullets.forEach((b,bi)=>entries.push({id:`current_resume:${s.role}:${bi}`,role:s.role,si,ac_id:b.ac_id,facet:b.facet,text:b.text})));
  entries.push({id:'current_resume:skills',role:null,text:skills.join('\n')});
  const roles=new Set(sections.map(s=>s.role));
  for(const a of bank.acs.filter(a=>roles.has(a.role)&&a.production_eligible!==false&&!['DRAFT','REJECTED'].includes(a.status))) {
    (a.variants||[]).forEach((v,i)=>{if(v.production_eligible===false||['DRAFT','REJECTED'].includes(v.status))return;entries.push({id:`story_bank:${a.id}:${i}`,role:a.role,ac_id:a.id,facet:v.facet,text:v.text});});
  }
  return entries;
}
export function groundedChanges(result,sections,skills,evidence,bank) {
  const sourceMap=new Map(evidence.map(e=>[e.id,e]));
  const knownSkills=loadSkills();
  const techs=text=>knownSkills.filter(s=>s.forms.some(f=>f.re.test(text))).map(s=>s.name);
  const missing=result.requirements.filter(r=>r.status==='MISSING').map(r=>r.requirement);
  const accepted=[],rejected=[];const used=new Set();
  for(const proposed of result.sectionChanges) {
    const si=sections.findIndex(s=>s.role===proposed.role),current=sections[si];
    try {
      if(!current||!['experience','project'].includes(current.kind)||used.has(si))throw Error('Unknown or repeated section');
      if(!proposed.bullets.length||proposed.bullets.length>current.bullets.length)throw Error('Keep existing bullet capacity; no empty experience');
      if(proposed.requirements.some(r=>missing.includes(r)))throw Error('Targets a missing requirement');
      const bullets=proposed.bullets.map(b=>{
        if(/<\/?[a-z][^>]*>|\\[a-z]+\s*\{/i.test(b.text))throw Error('Generated markup or template commands are forbidden');
        const e=sourceMap.get(b.evidence_source);
        if(!e||e.role!==current.role)throw Error('Evidence must belong to this employer or project');
        if(numeric(b.text).some(n=>!numeric(e.text).includes(n)))throw Error('Unsupported or modified metric');
        if(e.id.startsWith('current_resume:')&&JSON.stringify(numeric(b.text).sort())!==JSON.stringify(numeric(e.text).sort()))throw Error('Existing metrics changed or removed');
        if(techs(b.text).some(t=>!techs(e.text).includes(t)))throw Error('Unsupported technology');
        const issues=b.text===e.text&&e.id.startsWith('current_resume:')?[]:checkText(current.role,b.text,bank,{bankWide:true,acId:e.ac_id});if(issues.length)throw Error(issues.join('; '));
        return {ac_id:e.ac_id,facet:e.facet??null,text:b.text,custom:true,evidence_source:e.id,evidence_text:e.text};
      });
      if(new Set(bullets.map(b=>b.ac_id)).size!==bullets.length)throw Error('Repeated achievement evidence');
      const candidate=sections.map((s,i)=>i===si?{...s,bullets}:s);
      const verbs=candidate.flatMap(s=>s.bullets.map(b=>openingVerb(b.text)));if(new Set(verbs).size!==verbs.length)throw Error('Repeated action verb in resume');
      if(JSON.stringify(current.bullets.map(b=>b.text))===JSON.stringify(bullets.map(b=>b.text)))continue;
      accepted.push({kind:'section',si,bi:-1,current:current.bullets.map(b=>b.text).join('\n\n'),suggested:bullets.map(b=>b.text).join('\n\n'),originalHashInput:JSON.stringify(current.bullets),bullets,reason:proposed.reason,requirements:proposed.requirements,evidence_source:bullets.map(b=>b.evidence_source)});used.add(si);
    }catch(e){rejected.push({section:proposed.role,reason:e.message});}
  }
  try {
    const groups=result.skills_changes.groups;
    const labels=new Set([...knownSkills.map(s=>s.category),...skills.map(s=>s.split(':')[0])]);
    if(groups.some(g=>!labels.has(g.label)))throw Error('Unknown skill category');
    const skillNames=new Set();
    const lines=groups.map(g=>`${g.label}: ${g.skills.map(s=>{
      const e=sourceMap.get(s.evidence_source);if(!e)throw Error('Unknown skill evidence');
      const definition=knownSkills.find(k=>k.name.toLowerCase()===s.name.toLowerCase()||k.forms.some(f=>f.form.toLowerCase()===s.name.toLowerCase()));
      if(!definition||!definition.forms.some(f=>f.re.test(e.text)))throw Error(`Unsupported skill: ${s.name}`);
      if(skillNames.has(definition.name))throw Error('Repeated skill');skillNames.add(definition.name);
      return definition.name;
    }).join(', ')}`);
    if(lines.length&&JSON.stringify(lines)!==JSON.stringify(skills))accepted.push({kind:'skills',si:-1,bi:-1,current:skills.join('\n'),suggested:lines.join('\n'),skills:lines,reason:result.skills_changes.reason,requirements:[],evidence_source:groups.flatMap(g=>g.skills.map(s=>s.evidence_source))});
  }catch(e){rejected.push({section:'Technical Skills',reason:e.message});}
  return {accepted,rejected};
}
