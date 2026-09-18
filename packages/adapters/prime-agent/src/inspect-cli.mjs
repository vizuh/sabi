import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { probeRoot, probeEnvironment, probeSettings } from './profile.ts';
const root = probeRoot;
const binary = process.argv[2];
if (!binary || !path.isAbsolute(binary)) throw new Error('Provide installed binary absolute path');
for (const dir of ['a','home','sessions','tmp','cache','config','data','runtime','work']) await mkdir(path.join(root, dir), {recursive:true, mode:0o700});
const env=probeEnvironment('transport');
await writeFile(path.join(root,'a/settings.json'),JSON.stringify(probeSettings(),null,2)+'\n');
const reports = [];
for (const flag of ['--version','--help']) {
 const child = spawn(binary,[flag],{env,cwd:path.join(root,'work'),stdio:['ignore','pipe','pipe']});
 const entry={flag,pid:child.pid,timeoutMs:10000};
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 let output=''; let stderrBytes=0;
 child.stdout.on('data',d=>{ if(output.length<40000) output+=d.toString(); });
 child.stderr.on('data',d=>{stderrBytes+=d.length;});
 entry.exitCode = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 clearTimeout(timer);
 entry.stderrBytes=stderrBytes;
 if(flag==='--version')entry.version=output.trim();
 else entry.flags=output.split('\n').filter(l=>/--no-context-files|--no-builtin-tools|--no-session|--session-dir|--no-extensions|--no-skills|--offline|--no-themes|--no-prompt-templates|--cwd|--mode|--thinking/.test(l));
 reports.push(entry);
}
await writeFile(path.join(root,'cli-evidence.json'),JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports));
