import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {Client,Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';

export interface IsolatedDatabase {
 query<T = Record<string,unknown>>(text:string,values?:unknown[]):Promise<{rows:T[]}>;
 exec(text:string):Promise<unknown>;
 close():Promise<void>;
}
// Opt-in real PostgreSQL never accepts DATABASE_URL or a remote hostname.
// Each suite owns a fresh random database; only that database is dropped.
export async function isolatedDatabase():Promise<IsolatedDatabase>{
 const port=process.env.INTENTLOCK_TEST_POSTGRES_PORT;
 if(!port)return new PGlite({extensions:{pgcrypto}});
 if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw new Error('INVALID_LOCAL_TEST_POSTGRES_PORT');
 const config={host:'127.0.0.1',port:Number(port),user:'intentlock_test',database:'postgres',password:'isolated-local-test',connectionTimeoutMillis:5000};
 const admin=new Client(config);await admin.connect();
 const name='intentlock_test_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE DATABASE ${name}`);
 const pool=new Pool({...config,database:name,max:24});
 let transaction:PoolClient|undefined;
 return {
  async query<T>(text:string,values?:unknown[]){const result=await (transaction??pool).query(text,values);return {rows:result.rows as T[]};},
  async exec(text:string){
   if(/^BEGIN\s*;/i.test(text)&&!/(?:COMMIT|ROLLBACK)\s*;/i.test(text))transaction??=await pool.connect();
   try{return await (transaction??pool).query(text);}finally{
    if(transaction&&/^\s*(?:ROLLBACK|COMMIT)\s*;?\s*$/i.test(text)){transaction.release();transaction=undefined;}
   }
  },
  async close(){if(transaction){await transaction.query('ROLLBACK');transaction.release();}await pool.end();try{await admin.query(`DROP DATABASE ${name}`);}finally{await admin.end();}}
 };
}
