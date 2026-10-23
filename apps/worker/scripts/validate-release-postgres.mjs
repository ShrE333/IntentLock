// Disposable infrastructure only. Never reads DATABASE_URL or credential files.
import {Client,Pool} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Supply the disposable loopback PostgreSQL port.');
const config={host:'127.0.0.1',port,user:'intentlock_test',password:'isolated-local-test',database:'postgres',connectionTimeoutMillis:5000};
const admin=new Client(config);await admin.connect();
const name='intentlock_test_'+randomUUID().replaceAll('-','');
await admin.query(`CREATE DATABASE ${name}`);
const db=new Client({...config,database:name});await db.connect();
const order=JSON.parse(readFileSync(new URL('../db/release-order.json',import.meta.url),'utf8'));
async function apply(){
 let applied=0;
 for(const file of order){
  const source=readFileSync(new URL('../db/'+file,import.meta.url),'utf8');
  const hash=createHash('sha256').update(source).digest('hex');
  await db.query('BEGIN');
  try{
   await db.query('SELECT pg_advisory_xact_lock(11471147)');
   const existing=await db.query('SELECT checksum FROM release_test_migrations WHERE name=$1',[file]);
   if(existing.rows.length){if(existing.rows[0].checksum!==hash)throw new Error('MIGRATION_CHECKSUM_MISMATCH:'+file);}
   else{
    // Existing .5/.6 outer transactions become this journal transaction.
    const sql=source.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
    await db.query(sql);
    await db.query('INSERT INTO release_test_migrations(name,checksum) VALUES($1,$2)',[file,hash]);applied++;
   }
   await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
 }
 return applied;
}
try{
 await db.query('CREATE TABLE release_test_migrations(name text PRIMARY KEY,checksum text NOT NULL)');
 const first=await apply(),second=await apply();
 if(first!==order.length||second!==0)throw new Error('MIGRATION_REPEATABILITY_FAILED');
 const gates=await db.query(`SELECT to_regprocedure('settle_wallet_reservation_v11_4_5(text,text,numeric,text,text,text,text,text)') IS NOT NULL AS settlement,
  to_regclass('financial_resource_owners') IS NOT NULL AS ownership,
  to_regclass('paypal_recipient_observations') IS NOT NULL AS recipient`);
 if(Object.values(gates.rows[0]).some(v=>v!==true))throw new Error('RELEASE_SCHEMA_GATES_MISSING');
 await db.query(`INSERT INTO intent_wallets(wallet_id,name,currency,total_authority,auto_buy_limit,max_single_transaction,valid_until)
  VALUES('competition','isolated','USD',100,100,100,NOW()+INTERVAL '1 day');
  INSERT INTO financial_resource_owners(resource_type,resource_id,principal_id) VALUES('wallet','competition','demo:owner');
  INSERT INTO purchase_sessions(session_id,wallet_id,user_prompt,status,selected_product,selected_decision)
  SELECT 'contender-'||i,'competition','isolated','READY_TO_PAY','{"id":"p","price":7,"currency":"USD"}'::jsonb,'ALLOW' FROM generate_series(1,20) i;`);
 const pool=new Pool({...config,database:name,max:20});
 let concurrency;
 try{
  // Hold twenty independent clients before any contention starts.
  const clients=await Promise.all(Array.from({length:20},()=>pool.connect()));
  try{
   const pids=await Promise.all(clients.map(c=>c.query('SELECT pg_backend_pid() pid')));
   const connections=new Set(pids.map(r=>r.rows[0].pid)).size;
   if(connections!==20)throw new Error('SEPARATE_CONNECTIONS_NOT_ESTABLISHED');
   const outcomes=await Promise.allSettled(clients.map((c,i)=>c.query('SELECT * FROM reserve_wallet_authority_v11_4_5($1,$2,$3,$4,$5,$6,$7)',
    ['contender-'+(i+1),'competition','a'.repeat(64),'key-'+i,7,'USD','paypal'])));
   const admitted=outcomes.filter(o=>o.status==='fulfilled').length;
   const state=(await db.query("SELECT spent_amount::text,reserved_amount::text,total_authority::text FROM intent_wallets WHERE wallet_id='competition'")).rows[0];
   if(admitted!==14||Number(state.reserved_amount)!==98||Number(state.spent_amount)+Number(state.reserved_amount)>100)throw new Error('FULL_RELEASE_CONCURRENCY_INVARIANT_FAILED');
   const owner=await db.query("SELECT principal_id FROM financial_resource_owners WHERE resource_id='competition'");
   if(owner.rows[0].principal_id!=='demo:owner')throw new Error('OWNERSHIP_CHANGED_DURING_RESERVATION');
   concurrency={connections,admitted,rejected:20-admitted,...state};
  }finally{clients.forEach(c=>c.release());}
 }finally{await pool.end();}
 // Original one-shot scripts must reject a blind rerun without partial changes.
 await db.query('BEGIN');
 try{await db.query(readFileSync(new URL('../db/v11_4_4_financial_access.sql',import.meta.url),'utf8'));throw new Error('RAW_MIGRATION_UNEXPECTEDLY_REPEATABLE');}
 catch(error){if(error.code!=='42P07')throw error;}
 finally{await db.query('ROLLBACK');}
 console.log(JSON.stringify({postgres:await db.query('SHOW server_version').then(r=>r.rows[0].server_version),applied:first,repeatApplied:second,rawRepeat:'rejected atomically',gates:gates.rows[0],concurrency}));
}finally{await db.end();try{await admin.query(`DROP DATABASE ${name}`);}finally{await admin.end();}}
