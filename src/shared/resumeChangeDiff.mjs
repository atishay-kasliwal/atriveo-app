export function resumeChangeDiff(change){
 const old=change.kind==='section'?change.current.split(/\n\n+/):change.current.split('\n');
 const next=change.kind==='section'?(change.bullets?.map(b=>b.text)||change.suggested.split(/\n\n+/)):(change.skills||change.suggested.split('\n'));
 const remaining=[...next];const removed=[];let unchanged=0;
 for(const text of old){const at=remaining.indexOf(text);if(at<0)removed.push(text);else{remaining.splice(at,1);unchanged++;}}
 return {removed,added:remaining,unchanged,reordered:!removed.length&&!remaining.length&&JSON.stringify(old)!==JSON.stringify(next)};
}
