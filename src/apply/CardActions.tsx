import {useEffect,useRef,type ReactNode} from 'react';
import './card-actions.css';
export default function CardActions({children}:{children:ReactNode}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(ref.current?.open&&!ref.current.contains(event.target as Node))ref.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 return <details ref={ref} className="card-actions" onKeyDown={e=>{if(e.key==='Escape'&&ref.current){ref.current.open=false;ref.current.querySelector('summary')?.focus();}}}><summary>More <span aria-hidden="true">⋯</span></summary><div className="card-actions-content" onClick={e=>{if((e.target as HTMLElement).closest('button,a')&&ref.current)ref.current.open=false;}}>{children}</div></details>;
}
