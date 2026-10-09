export function resumeContactLink(value) {
 const raw=String(value||'');
 try {const url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);if(!['https:','http:'].includes(url.protocol))return {label:raw,href:null};const host=url.hostname.replace(/^www\./i,'');const segments=url.pathname.split('/').filter(Boolean);const handle=host==='linkedin.com'&&segments[0]==='in'?segments[1]:host==='github.com'?segments[0]:null;return {label:handle?`${host==='github.com'?'github':'linkedin'}/${handle}`:raw.replace(/^https?:\/\/(?:www\.)?/i,'').replace(/\/$/,''),href:url.href};}catch{return {label:raw,href:null};}
}
