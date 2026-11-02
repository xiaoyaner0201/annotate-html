import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const root=process.cwd();
export const policies=[
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "default-src 'none'; script-src 'self'; style-src 'self' 'nonce-abc123'; style-src-attr 'self'; img-src * 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'",
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'"
];
export function startServer(){return new Promise(resolve=>{
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');const policy=Number(url.searchParams.get('csp')||0);
    res.setHeader('Content-Security-Policy',policies[policy]);
    if(url.pathname==='/submit') {let body=[];req.on('data',b=>body.push(b));req.on('end',()=>{server.lastBody=Buffer.concat(body).toString('latin1');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'Received',url:'/ticket/1'}));});return;}
    if(url.pathname==='/missing') {res.statusCode=404;res.end('not found');return;}
    if(url.pathname==='/fixture') {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Feedback test</title><meta name="app-version" content="1.2.3"><link rel="stylesheet" href="/tests/fixture.css"></head><body><section id="panel"><h2>Release dashboard</h2><p>Monitor the next deployment</p><button id="target" data-testid="save-button">Save changes</button><input id="secret" type="password" value="classified"></section><script src="/annotate.js"></script></body></html>`);return;}
    try{const path=join(root,url.pathname.replace(/^\//,''));const bytes=readFileSync(path);res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end('not found');}
  });server.listen(0,'127.0.0.1',()=>resolve({server,base:`http://127.0.0.1:${server.address().port}`}));
});}
