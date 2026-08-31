const argv=process.argv.slice(2).filter(arg=>arg!=='--');
const operation=argv.shift()??'discover';
const flags:Record<string,string>={};
for(let i=0;i<argv.length;i++){const key=argv[i];if(!key?.startsWith('--')||!argv[i+1])throw new Error('Expected --flag value');flags[key.slice(2)]=argv[++i]!;}
const base=(flags.base??'http://127.0.0.1:8477').replace(/\/$/,'');
async function request(path:string,body?:unknown){
  const headers:Record<string,string>={'x-tot-client':'agent'};
  if(body){const d=await fetch(base+'/api/v2/discover').then(r=>r.json());headers['x-tot-nonce']=d.nonce;headers['content-type']='application/json';}
  const response=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
  const type=response.headers.get('content-type')??'';
  const value=type.includes('application/json')?await response.json():{ok:response.ok,format:flags.format??'text',content:await response.text()};
  if(!response.ok)process.exitCode=1;
  return value;
}
try{
  let result:unknown;
  if(operation==='discover')result=await request('/api/v2/discover');
  else if(operation==='list')result=await request('/api/v2/tournaments');
  else if(operation==='create'){
    if(flags.mode&&flags.mode!=='rehearsal')throw new Error('Agents create rehearsal only; human choices belong to the UI');
    const body:Record<string,unknown>={requestId:flags.request??crypto.randomUUID(),mode:'rehearsal'};
    if(flags.json)Object.assign(body,JSON.parse(flags.json),{mode:'rehearsal'});
    result=await request('/api/v2/tournaments',body);
  }else{
    if(!flags.session||!/^[a-f0-9-]{36}$/i.test(flags.session))throw new Error('--session requires the exact tournament UUID');
    const path='/api/v2/tournaments/'+flags.session;
    if(operation==='inspect')result=await request(path);
    else if(operation==='act'){if(!flags.json)throw new Error('--json requires an action envelope');result=await request(path+'/actions',JSON.parse(flags.json));}
    else if(operation==='wait')result=await request(path+'/wait?'+new URLSearchParams({after:flags.after??'-1',timeout:flags.timeout??'3000'}));
    else if(operation==='diagnose')result=await request(path+'/diagnose');
    else if(operation==='export')result=await request(path+'/export?format='+encodeURIComponent(flags.format??'json'));
    else throw new Error('Operations: discover, list, create, inspect, act, wait, diagnose, export');
  }
  console.log(JSON.stringify(result,null,2));
}catch(error){console.log(JSON.stringify({ok:false,error:{message:error instanceof Error?error.message:String(error)}}));process.exitCode=1;}
export {};
