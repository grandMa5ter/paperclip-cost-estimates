import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareValuation, apiOrigin, createConnector, ESTIMATE_BILLER} from '../src/connector.ts';
const company='11111111-1111-1111-1111-111111111111';
const source={id:'22222222-2222-2222-2222-222222222222',company_id:company,agent_id:'33333333-3333-3333-3333-333333333333',
 issue_id:null,project_id:null,goal_id:null,heartbeat_run_id:null,provider:'anthropic',model:'example',biller:'anthropic',
 billing_type:'subscription_included',cost_cents:0,input_tokens:100000,cached_input_tokens:500000,output_tokens:20000,occurred_at:'2026-10-12T00:00:00Z'};
const snapshot={sha256:'test-snapshot',models:{'anthropic:example':{input:.000004,cacheRead:.0000002,output:.00002}}};
test('valuation feeds native cents and attribution without duplicating tokens',()=>{
 const v=prepareValuation(source,snapshot);
 assert.equal(v.payload.costCents,90);
 assert.equal(v.payload.agentId,source.agent_id);
 assert.equal(v.payload.occurredAt,'2026-10-12T00:00:00.000Z');
 assert.equal(v.payload.biller,ESTIMATE_BILLER);
 assert.deepEqual([v.payload.inputTokens,v.payload.cachedInputTokens,v.payload.outputTokens],[0,0,0]);
 assert.equal(v.snapshotHash,'test-snapshot');
});
test('API charges and connector-generated charges are never repriced',()=>{
 assert.equal(prepareValuation({...source,billing_type:'metered_api',cost_cents:20},snapshot),null);
 assert.equal(prepareValuation({...source,biller:ESTIMATE_BILLER,billing_type:'fixed'},snapshot),null);
 assert.equal(prepareValuation({...source,model:'unknown'},snapshot),null);
});
test('credential target rejects userinfo, public HTTP and URL paths',()=>{
 assert.equal(apiOrigin('http://127.0.0.1:3100'),'http://127.0.0.1:3100');
 for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com?token=x']) assert.throws(()=>apiOrigin(url));
});
function harness(){
 const records=new Map(), native=[];
 const ctx={db:{namespace:'plugin_test',
  async query(sql,args){
   if(sql.startsWith('SELECT c.*')) return records.has(source.id)?[]:[source];
   if(sql.startsWith('SELECT * FROM public.cost_events')) return native.filter(row=>row.billing_code===args[1]);
   if(sql.startsWith('SELECT * FROM plugin_test.valuations')) return [...records.values()].filter(row=>['prepared','sending','uncertain'].includes(row.status));
   throw Error('Unexpected query');
  },async execute(sql,args){
   if(sql.startsWith('INSERT')){if(records.has(args[0]))return {rowCount:0};records.set(args[0],{source_id:args[0],company_id:args[1],billing_code:args[2],status:args[3],cost_cents:args[4],payload:JSON.parse(args[5]),pricing_sha256:args[6]});return {rowCount:1};}
   const row=records.get(args[0]);
   if(sql.includes("status = 'sending'")){if(row.status!=='prepared')return {rowCount:0};row.status='sending';}
   else if(sql.includes("status = 'written'")){row.status='written';row.native_id=args[1];}
   else if(sql.includes("status = 'uncertain'")){row.status='uncertain';}
   else throw Error('Unexpected mutation');
   return {rowCount:1};
  }},config:{get:async()=>({enabled:true,apiBase:'http://127.0.0.1:3100',apiToken:{type:'secret_ref',secretId:'secret'}})},
  secrets:{resolve:async()=> 'fixture-token'}};
 function receive(payload){native.push({id:'44444444-4444-4444-4444-444444444444',billing_code:payload.billingCode,biller:payload.biller,billing_type:payload.billingType,cost_cents:payload.costCents,agent_id:payload.agentId,model:payload.model,provider:payload.provider,issue_id:payload.issueId,project_id:payload.projectId,heartbeat_run_id:payload.heartbeatRunId,input_tokens:0,cached_input_tokens:0,output_tokens:0});}
 return {ctx,records,native,receive,connector:createConnector(ctx,{get:async()=>({snapshot})})};
}
test('repeat, concurrent and restarted sync write exactly one native valuation',async t=>{
 const h=harness();let posts=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{posts++;assert.match(url,/\/cost-events$/);h.receive(JSON.parse(init.body));return Response.json({id:h.native[0].id},{status:201});});
 await Promise.all([h.connector.sync(company),h.connector.sync(company)]);
 await createConnector(h.ctx,{get:async()=>({snapshot})}).sync(company);
 assert.equal(posts,1);assert.equal(h.native.length,1);assert.equal(h.records.get(source.id).status,'written');
});
test('lost response after accepted write is reconciled without resending',async t=>{
 const h=harness();let posts=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{posts++;h.receive(JSON.parse(init.body));throw Error('connection lost');});
 await h.connector.sync(company);await h.connector.sync(company);
 assert.equal(posts,1);assert.equal(h.records.get(source.id).status,'written');
});
test('uncertain write without a receipt is never automatically retried',async t=>{
 const h=harness();let posts=0;
 t.mock.method(globalThis,'fetch',async()=>{posts++;throw Error('timeout');});
 await assert.rejects(h.connector.sync(company),/uncertain/);
 await h.connector.sync(company);
 assert.equal(posts,1);assert.equal(h.records.get(source.id).status,'uncertain');
});
