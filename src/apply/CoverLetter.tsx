import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {getTailorServerBase} from '../utils/tailorServer';
import './cover-letter.css';
type Source={jobUrl?:string;pasted?:string};
type Draft={version:string;paragraphs:string[];pdfPath:string|null;updatedAt:string};
type Result={draft?:Draft|null;version:string;stale?:boolean;busy:boolean;error?:string|null};
async function request(body:object):Promise<Result>{
 const r=await fetch(`${getTailorServerBase()}/matching-cover-letter`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'Could not load the cover letter.');return data;
}
function Editor({source,onClose}:{source:Source;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [state,setState]=useState<Result|null>(null),[text,setText]=useState(''),[instruction,setInstruction]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const sourceKey=JSON.stringify(source);
 useEffect(()=>{dialog.current?.showModal();},[]);
 useEffect(()=>{
  let cancelled=false;
  async function poll(){try{const next=await request({source,action:'status'});if(cancelled)return;setState(next);setText(next.draft?.paragraphs.join('\n\n')||'');setError(next.error||'');}catch(e){if(!cancelled)setError(e instanceof Error?e.message:String(e));}}
  void poll();return()=>{cancelled=true;};
 },[sourceKey]); // source identity stays fixed for this editor
 useEffect(()=>{
  if(!state?.busy)return;
  let cancelled=false;
  const timer=setInterval(()=>{void request({source,action:'status'}).then(next=>{if(cancelled)return;setState(next);setError(next.error||'');if(!next.busy)setText(next.draft?.paragraphs.join('\n\n')||'');}).catch(e=>{if(!cancelled){setError(String(e.message||e));setState(s=>s?{...s,busy:false}:s);}});},2500);
  return()=>{cancelled=true;clearInterval(timer);};
 },[state?.busy,sourceKey]);
 const paragraphs=text.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
 const dirty=JSON.stringify(paragraphs)!==JSON.stringify(state?.draft?.paragraphs||[]);
 const act=async(action:string)=>{setWorking(true);setError('');try{const next=await request({source,action,version:state?.version,instruction,paragraphs});setState(next);if(next.draft)setText(next.draft.paragraphs.join('\n\n'));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}};
 const busy=working||state?.busy;
 const pdf=state?.draft?.pdfPath&&!dirty&&!state.stale?`${getTailorServerBase()}/serve-pdf?path=${encodeURIComponent(state.draft.pdfPath)}`:null;
 return createPortal(<dialog ref={dialog} className="cl-dialog" aria-labelledby="cl-title" onCancel={onClose}><header><h2 id="cl-title">Cover Letter</h2><button className="apps-btn" aria-label="Close cover letter" onClick={onClose}>×</button></header><p>Uses the points selected for your saved resume and this job's description.</p>{state?.stale&&<p role="status" className="cl-warning">Your resume points changed. Regenerate this letter to match the current resume.</p>}{error&&<p role="alert" className="td-error">{error}</p>}{!state&&!error&&<p role="status">Loading cover letter…</p>}{state&&<><label htmlFor="cl-instruction">Revision request (optional)</label><input id="cl-instruction" value={instruction} maxLength={2000} onChange={e=>setInstruction(e.target.value)} placeholder="e.g. Shorter, with more focus on financial systems" disabled={Boolean(busy)}/><button className="apps-btn" disabled={Boolean(busy)} onClick={()=>void act('generate')}>{state.draft?'Regenerate with Codex':'Create with Codex'}</button>{busy&&<p role="status">{state.busy?'Codex is drafting your letter. You can close this and return.':'Saving…'}</p>}{text&&<><label htmlFor="cl-text">Letter body</label><textarea id="cl-text" rows={15} value={text} onChange={e=>setText(e.target.value)} disabled={Boolean(busy)||state.stale}/><footer><button className="apps-btn" disabled={Boolean(busy)||state.stale||!dirty} onClick={()=>void act('save')}>Save draft</button><button className="apps-btn" disabled={Boolean(busy)||state.stale} onClick={()=>void act('pdf')}>Generate PDF</button>{pdf&&<><a className="apps-btn" href={`${pdf}&dl=1`}>Download</a><a className="apps-link" href={pdf} target="_blank" rel="noreferrer">Preview PDF ↗</a></>}</footer>{pdf&&<iframe title="Cover letter PDF preview" src={pdf}/>}</>}</>}</dialog>,document.body);
}
export default function CoverLetter({source,disabled=false}:{source:Source;disabled?:boolean}){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="apps-btn" disabled={disabled} title={disabled?'Save your selected resume points first':undefined} onClick={()=>setOpen(true)}>Cover Letter</button>{open&&<Editor key={JSON.stringify(source)} source={source} onClose={()=>setOpen(false)}/>}</>;
}
