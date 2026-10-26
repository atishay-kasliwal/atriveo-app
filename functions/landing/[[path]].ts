interface Env {ASSETS:{fetch(input:Request|URL|string):Promise<Response>}}
/** Public product pages, isolated from the private console's SPA fallback and auth. */
export const onRequestGet:PagesFunction<Env>=async({request,env})=>{
 const url=new URL(request.url),path=url.pathname;
 if(path==='/landing'||path==='/landing/index.html')return Response.redirect(new URL('/landing/',url).toString(),301);
 if(path==='/landing/workflow'||path==='/landing/workflow/index.html')return Response.redirect(new URL('/landing/workflow/',url).toString(),301);
 if(path==='/landing/'||path==='/landing/workflow/')return env.ASSETS.fetch(new URL(`${path}index.html`,url));
 if(path.startsWith('/landing/assets/')||['/landing/styles.css','/landing/sitemap.xml','/landing/robots.txt'].includes(path)){
  const response=await env.ASSETS.fetch(request);if(!response.headers.get('content-type')?.includes('text/html'))return response;
 }
 const response=await env.ASSETS.fetch(new URL('/landing/404.html',url));return new Response(response.body,{status:404,headers:{'Content-Type':'text/html;charset=utf-8','X-Robots-Tag':'noindex'}});
};
