// Profile links print their full address (linkedin.com/in/<handle>, github.com/<handle>): extracted text keeps only
// what is printed, and an ATS reading "linkedin/<handle>" loses the URL (readiness flags it as a hidden link).
export function resumeContactLink(value) {
 const raw=String(value||'');
 try {const url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);if(!['https:','http:'].includes(url.protocol))return {label:raw,href:null};const host=url.hostname.replace(/^www\./i,'');const path=url.pathname.replace(/\/+$/,'');return {label:`${host}${path}`,href:url.href};}catch{return {label:raw,href:null};}
}
