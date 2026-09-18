import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { probeRoot, probeVariants, probeEnvironment, probeSettings, probeModels, mockSabiConfig } from './profile.ts';
const root = probeRoot;
const [binary,variant='proxy'] = process.argv.slice(2);
if (!binary || !path.isAbsolute(binary) || !probeVariants.includes(variant)) throw new Error('Usage: node probe.mjs ABSOLUTE_BINARY transport|native|native-followup|proxy');
const evidence = {variant,binaryVersion:null,requests:[],clientEvents:[],deadlineMs:25000,exitCode:null,timedOut:false,stderrBytes:0,diagnostics:[]};
for (const dir of ['a','home','sessions','tmp','cache','config','data','runtime','work']) await mkdir(path.join(root,dir),{recursive:true,mode:0o700});
const eventsPath=path.join(root,`${variant}-extension.jsonl`);
await writeFile(eventsPath,'');
const env=probeEnvironment(variant);
// Refuse a different installed release rather than labeling it with stale evidence.
const versionClient=spawn(binary,['--version'],{env,cwd:path.join(root,'work'),stdio:['ignore','pipe','ignore']});
evidence.versionPid=versionClient.pid;
let versionOutput='';
versionClient.stdout.on('data',d=>{if(versionOutput.length<100)versionOutput+=d.toString();});
const versionTimer=setTimeout(()=>versionClient.kill('SIGKILL'),10000);
const versionExit=await new Promise((resolve,reject)=>{versionClient.once('error',reject);versionClient.once('exit',resolve);});
clearTimeout(versionTimer);
evidence.binaryVersion=versionOutput.trim();
if(versionExit!==0||evidence.binaryVersion!=='0.9.5')throw new Error('Probe requires installed Prime Agent 0.9.5; recheck its contract before use');
await writeFile(path.join(root,'a/settings.json'),JSON.stringify(probeSettings(),null,2)+'\n');
await writeFile(path.join(root,'probe-extension.ts'),await readFile(new URL('./probe-extension.mjs',import.meta.url),'utf8'));
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>512000)throw new Error('request too large');chunks.push(chunk);}
    const payload=JSON.parse(Buffer.concat(chunks).toString());
    const turn=evidence.requests.length;
    const messages=payload.messages??[];
    evidence.requests.push({turn,parameterNames:Object.keys(payload).sort(),sabiHeadersStripped:!Object.keys(req.headers).some(k=>k.startsWith('x-sabi-')),method:req.method,path:req.url,model:payload.model,effort:payload.reasoning_effort??null,stream:payload.stream,includeUsage:payload.stream_options?.include_usage??null,maxTokens:payload.max_tokens??payload.max_completion_tokens??null,roles:messages.map(m=>m.role),tools:(payload.tools??[]).map(t=>t.function?.name),toolCallIds:messages.flatMap(m=>(m.tool_calls??[]).map(t=>t.id)),toolResultIds:messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),toolResultOrderCorrect:messages.filter(m=>m.role==='tool').every((m,i)=>m.content===`probe-step-${i+1}-ok`),placeholderAuth:req.headers.authorization==='Bearer sabi-local-placeholder'});
    if(turn>(variant==='native-followup'?3:2)){res.writeHead(409,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'bounded mock complete'}}));return;}
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
    const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:`mock-${turn}`,object:'chat.completion.chunk',created:1,model:payload.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
    send({role:'assistant'});
    if(turn===0){
      // Two parallel calls. Argument JSON is fragmented across SSE events.
      send({tool_calls:[{index:0,id:'call_probe_1',type:'function',function:{name:'sabi_probe',arguments:'{"ste'}},{index:1,id:'call_probe_2',type:'function',function:{name:'sabi_probe',arguments:'{"step":'}}]});
      send({tool_calls:[{index:0,function:{arguments:'p":1}'}},{index:1,function:{arguments:'2}'}}]});
      send({},'tool_calls');
    }else if(turn===1){
      send({tool_calls:[{index:0,id:'call_probe_3',type:'function',function:{name:'sabi_probe',arguments:'{"step":3}'}}]});
      send({},'tool_calls');
    }else{send({content:'SABI_MOCK_COMPLETE'});send({},'stop');}
    res.write(`data: ${JSON.stringify({id:`mock-${turn}`,object:'chat.completion.chunk',created:1,model:payload.model,choices:[],usage:{prompt_tokens:20+turn*10,completion_tokens:5,total_tokens:25+turn*10}})}\n\n`);
    res.end('data: [DONE]\n\n');
  }catch{evidence.diagnostics.push('mock_request_rejected');if(!res.headersSent)res.writeHead(400);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
evidence.mockPort=port;
let proxy;
let apiPort=port;
if(variant==='proxy'){
  const { createSabiServer }=await import('@sabi/server');
  const config=mockSabiConfig(port);
  proxy=createSabiServer({config,logFile:path.join(root,'proxy-decisions.jsonl'),verbose:false,requestTimeoutMs:5000});
  apiPort=await proxy.listen(0,'127.0.0.1');
  evidence.proxyPort=apiPort;
}
await writeFile(path.join(root,'a/models.json'),JSON.stringify(probeModels(apiPort),null,2)+'\n');
function capture(child){
 let buffer='';let stderr='';let completed=0;
 child.stdout.on('data',chunk=>{
  buffer+=chunk.toString();
  if(buffer.length>2000000){evidence.diagnostics.push('stdout_bound');child.kill('SIGTERM');buffer='';return;}
  let newline;
  while((newline=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
   try{
    const event=JSON.parse(line); const item={type:event.type};
    if(variant==='native-followup'&&event.type==='agent_end'){
      completed++;
      if(completed===1)child.stdin.write(JSON.stringify({id:'followup',type:'prompt',message:'Return the second synthetic receipt.'})+'\n');
      else child.stdin.end();
    }
    if(event.type==='session')item.id=event.id;
    if(event.toolCallId)item.toolCallId=event.toolCallId;
    if(event.toolName)item.toolName=event.toolName;
    if(typeof event.isError==='boolean')item.isError=event.isError;
    if(event.message?.role==='assistant'){
     item.model=event.message.model;item.stopReason=event.message.stopReason;
     if(event.message.usage)item.usage={input:event.message.usage.input,output:event.message.usage.output,totalTokens:event.message.usage.totalTokens};
     if(event.message.errorMessage)item.errorPresent=true;
    }
    if(['session','agent_start','agent_end','turn_start','turn_end','tool_execution_start','tool_execution_end','message_end','auto_retry_start','auto_retry_end'].includes(event.type))evidence.clientEvents.push(item);
   }catch{evidence.diagnostics.push('non_json_stdout');}
  }
 });
 child.stderr.on('data',chunk=>{evidence.stderrBytes+=chunk.length;if(stderr.length<100000)stderr+=chunk.toString();});
 child.once('exit',()=>{
  for(const [name,regex]of [['extension_load_error',/Failed to load extension|Cannot find module|ModuleNotFound/],['unix_socket_path',/ENAMETOOLONG|socket path/],['credentials_missing',/No API key|credentials/i],['runtime_bootstrap',/bootstrap|Installing|Downloading/i],['timeout',/timed out|Timeout/],['invalid_options',/unknown option|Unknown argument|unrecognized/i]])if(regex.test(stderr))evidence.diagnostics.push(name);
 });
}
const args=['--mode','json','--offline','--no-session','--session-dir',path.join(root,'sessions'),'--no-builtin-tools','--tools','sabi_probe','--no-extensions','--extension',path.join(root,'probe-extension.ts'),'--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--provider','sabi-local-probe','--model','sabi-code','--thinking','medium','--system-prompt','Synthetic local protocol fixture only. Use only sabi_probe.','Return the synthetic receipt.'];
if(variant==='native-followup'){args[1]='rpc';args.pop();}
const child=spawn(binary,args,{env,cwd:path.join(root,'work'),stdio:[variant==='native-followup'?'pipe':'ignore','pipe','pipe']});
evidence.clientPid=child.pid;capture(child);
if(variant==='native-followup')child.stdin.write(JSON.stringify({id:'initial',type:'prompt',message:'Return the synthetic receipt.'})+'\n');
const timer=setTimeout(()=>{evidence.timedOut=true;child.kill('SIGTERM');},evidence.deadlineMs);
const killTimer=setTimeout(()=>child.kill('SIGKILL'),evidence.deadlineMs+3000);
evidence.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
clearTimeout(timer);clearTimeout(killTimer);
// Stop only the daemon selected by this isolated environment.
const shutdown=spawn(binary,['shutdown','--force'],{env,cwd:path.join(root,'work'),stdio:'ignore'});
evidence.shutdownPid=shutdown.pid;
const stopTimer=setTimeout(()=>shutdown.kill('SIGKILL'),10000);
evidence.shutdownExitCode=await new Promise((resolve,reject)=>{shutdown.once('error',reject);shutdown.once('exit',resolve);});
clearTimeout(stopTimer);
// Discard only diagnostics produced in this probe-owned profile. Never retain raw client logs.
let discardedDiagnosticFiles=0;
for(const entry of await readdir(path.join(root,'a/logs'),{withFileTypes:true}).catch(()=>[])){
  if(entry.isFile()&&/\.(log|jsonl)$/.test(entry.name)){
    await unlink(path.join(root,'a/logs',entry.name)); discardedDiagnosticFiles++;
  }
}
for(const entry of await readdir(path.join(root,'a/daemon-workers'),{withFileTypes:true}).catch(()=>[])){
  if(entry.isDirectory()){
    try{await unlink(path.join(root,'a/daemon-workers',entry.name,'command-journal.jsonl'));discardedDiagnosticFiles++;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
evidence.discardedDiagnosticFiles=discardedDiagnosticFiles;
if(proxy){
  evidence.proxyDecisions=proxy.recent.map(d=>({alias:d.alias,client:d.client,sessionKnown:d.sessionKnown,requestId:d.requestId,tier:d.tier,upstreamModel:d.upstreamModel,servedModel:d.servedModel,outcome:d.outcome,usage:d.usage}));
  proxy.server.closeAllConnections();await proxy.close();
}
server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
evidence.extensionEvents=(await readFile(eventsPath,'utf8')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
evidence.sessionFiles=await readdir(path.join(root,'sessions'));
const toolEvents=evidence.extensionEvents.filter(e=>e.type==='synthetic_tool');
evidence.checks={expectedRequestCount:evidence.requests.length===(variant==='native-followup'?4:3),threeToolExecutions:toolEvents.length===3,distinctToolIds:new Set(toolEvents.map(e=>e.toolCallId)).size===3,oneSession:new Set(evidence.extensionEvents.filter(e=>e.sessionId).map(e=>e.sessionId)).size===1,onlySyntheticTool:evidence.requests.every(e=>e.tools.length===1&&e.tools[0]==='sabi_probe'),historyPreserved:evidence.requests[2]?.toolResultIds.join(',')==='call_probe_1,call_probe_2,call_probe_3'&&evidence.requests.every(e=>e.toolResultOrderCorrect),ephemeral:evidence.sessionFiles.length===0};
if(variant.startsWith('native'))evidence.checks.roundChangesApplied=evidence.requests.map(e=>`${e.model}/${e.effort}`).join(',')==='probe-first/low,probe-second/high,probe-first/minimal';
await writeFile(path.join(root,`${variant}-evidence.json`),JSON.stringify(evidence,null,2)+'\n');
const expectedChecks=Object.entries(evidence.checks).every(([key,passed])=>key==='roundChangesApplied'||passed===true);
if(evidence.exitCode!==0||evidence.timedOut||evidence.shutdownExitCode!==0||!expectedChecks||evidence.diagnostics.length)process.exitCode=1;
console.log(JSON.stringify({variant,exitCode:evidence.exitCode,timedOut:evidence.timedOut,shutdownExitCode:evidence.shutdownExitCode,requests:evidence.requests.map(({turn,model,effort})=>({turn,model,effort})),checks:evidence.checks,diagnostics:evidence.diagnostics}));
