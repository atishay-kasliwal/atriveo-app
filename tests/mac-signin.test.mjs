import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {build} from 'esbuild';
import {SignJWT} from 'jose';

// The Pages functions for "Sign in with Google" in the Mac app, bundled and run with a fake request and environment.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mac-signin-'));
const bundle=async name=>{const out=path.join(dir,`${name}.mjs`);await build({entryPoints:[path.resolve(`functions/api/auth/${name}.ts`)],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});return import(out);};
const mac=await bundle('mac'),exchange=await bundle('mac-exchange');
const env={JWT_SECRET:'x'.repeat(40),SITE:'apply',ADMIN_EMAILS:'me@example.test'};
const secret=new TextEncoder().encode(env.JWT_SECRET);
const b64url=buf=>Buffer.from(buf).toString('base64url');
const verifier=b64url(crypto.randomBytes(32)),challenge=b64url(crypto.createHash('sha256').update(verifier).digest());
const session=(email='me@example.test')=>new SignJWT({email,name:'Me'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(secret);
const startRequest=async(cookie='')=>mac.onRequestGet({request:new Request(`https://apply.atriveo.com/api/auth/mac?challenge=${challenge}`,{headers:cookie?{cookie}:{}}),env});
const exchangeRequest=body=>exchange.onRequestPost({request:new Request('https://apply.atriveo.com/api/auth/mac-exchange',{method:'POST',body:JSON.stringify(body)}),env});
const codeFrom=async res=>{const html=await res.text();return /atriveo:\/\/signin\?code=([\w.-]+)/.exec(html)?.[1];};

test('signed out: the start goes through Google and remembers the challenge in a short cookie',async()=>{
 const res=await startRequest();
 assert.equal(res.status,302);assert.equal(res.headers.get('location'),'/api/auth/google');
 const cookie=res.headers.get('set-cookie');assert.ok(cookie.includes(`mac_challenge=${challenge}`)&&/HttpOnly/.test(cookie)&&/Max-Age=600/.test(cookie)&&/Path=\/api\/auth/.test(cookie));
});
test('a bad challenge is refused',async()=>{
 const res=await mac.onRequestGet({request:new Request('https://apply.atriveo.com/api/auth/mac?challenge=short'),env});assert.equal(res.status,400);
});
test('signed in: a code comes back for the app, and the code plus the secret trades for a 60-day session',async()=>{
 const res=await startRequest(`atriveo_token=${await session()}`);
 assert.equal(res.status,200);const code=await codeFrom(res);assert.ok(code,'the page hands atriveo://signin?code=...');
 const ok=await exchangeRequest({code,verifier});assert.equal(ok.status,200);
 const body=await ok.json();assert.equal(body.ok,true);assert.ok(body.token);
 const {jwtVerify}=await import('jose');const {payload}=await jwtVerify(body.token,secret);assert.equal(payload.email,'me@example.test');assert.ok(payload.exp-payload.iat>=59*86400);
});
test('the code is useless without the secret, and a login token is not a code',async()=>{
 const code=await codeFrom(await startRequest(`atriveo_token=${await session()}`));
 assert.equal((await exchangeRequest({code,verifier:b64url(crypto.randomBytes(32))})).status,401);
 assert.equal((await exchangeRequest({code:await session(),verifier})).status,401);
 assert.equal((await exchangeRequest({code,verifier:'short'})).status,400);
 assert.equal((await exchangeRequest({})).status,400);
});
test('an email off the allowlist gets no code',async()=>{
 const res=await startRequest(`atriveo_token=${await session('stranger@example.test')}`);
 assert.equal(res.status,302,'treated as signed out');
});
