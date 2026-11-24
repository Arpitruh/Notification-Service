import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';

export const demoRoutes = Router();
const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const scope = 'public-demo:'; // Colon cannot occur in application slugs.
const templates = {
  welcome: { subject: 'Notification Service demo — Welcome', html: '<h1>Welcome!</h1><p>This is a real test email requested by you from the Notification Service demo.</p>' },
  alert: { subject: 'Notification Service demo — Alert', html: '<h1>Sample alert</h1><p>Your requested demo notification was processed by the real delivery worker.</p>' },
};
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const emailSchema = z.email().max(254).transform(v => v.toLowerCase());
const quota = async (tx: import('@prisma/client').Prisma.TransactionClient, key: string, max: number) => {
  // Atomic persistent UTC-day counters; no dependence on Redis durability.
  const day = new Date().toISOString().slice(0,10);
  const rows = await tx.$queryRaw<{count: number}[]>`INSERT INTO demo_quota (key, day, count) VALUES (${key}, ${day}, 1) ON CONFLICT (key, day) DO UPDATE SET count = demo_quota.count + 1 WHERE demo_quota.count < ${max} RETURNING count`;
  if (!rows.length) throw new Error('DEMO_QUOTA');
};
async function enqueue(tx: import('@prisma/client').Prisma.TransactionClient, recipient: string, owner: string, rendered: {subject:string;html:string}, template: string) {
  const id = crypto.randomUUID();
  await tx.notification.create({data:{id,idempotency_key:digest(id),recipient,channel:'email',template_id:template,payload_data:{},rendered_email:rendered,status:'pending',caller_service:scope+owner,expires_at:new Date(Date.now()+15*60_000)}});
  await tx.notificationOutbox.create({data:{notification_id:id}});
  return id;
}
demoRoutes.use((_req,res,next)=>{res.set('Cache-Control','no-store');if(process.env.DEMO_LIVE_ENABLED!=='true'){res.status(503).json({error:'Live demo is not enabled'});return;}next();});
demoRoutes.use(rateLimit({windowMs:60_000,limit:30}));
demoRoutes.post('/challenge', rateLimit({windowMs:60_000,limit:2}), async (req,res)=>{
  const input=z.object({email:emailSchema,captcha:z.string().min(1).max(2048)}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Valid email and CAPTCHA required'});return;}
  const secret=process.env.DEMO_TURNSTILE_SECRET;
  if(!secret){res.status(503).json({error:'CAPTCHA unavailable'});return;}
  const check=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret,response:input.data.captcha}),signal:AbortSignal.timeout(8000)});
  const result=await check.json() as {success?:boolean;action?:string;hostname?:string};
  if(!check.ok||!result.success||result.action!=='demo_verify'||!process.env.DEMO_HOSTNAME||result.hostname!==process.env.DEMO_HOSTNAME){res.status(403).json({error:'CAPTCHA verification failed'});return;}
  const token=crypto.randomBytes(32).toString('hex'), code=crypto.randomInt(100000,1000000).toString();
  const hash=digest(token), email=input.data.email;
  try{
    await prisma.$transaction(async tx=>{
      await quota(tx,'global',30);
      await quota(tx,'challenge:'+digest(email),2);
      await quota(tx,'ip:'+digest(req.ip||'unknown'),5);
      await tx.$executeRaw`INSERT INTO demo_session (token_hash,email,code_hash,expires_at) VALUES (${hash},${email},${digest(token+code)},NOW()+INTERVAL '10 minutes')`;
      await enqueue(tx,email,hash,{subject:'Notification Service demo verification',html:'<p>You requested a demo. Your verification code is <b>'+code+'</b>. It expires in 10 minutes. Ignore this email if you did not request it.</p>'},'demo-verification');
    });
    res.status(202).json({token});
  }catch(e){if(e instanceof Error&&e.message==='DEMO_QUOTA'){res.status(429).json({error:'Demo sending limit reached'});return;}throw e;}
});
demoRoutes.post('/verify',async(req,res)=>{
  const input=z.object({token:tokenSchema,code:z.string().regex(/^\d{6}$/)}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Invalid verification request'});return;}
  const hash=digest(input.data.token);
  const rows=await prisma.$queryRaw<{verified:boolean}[]>`UPDATE demo_session SET attempts=attempts+1, verified=(code_hash=${digest(input.data.token+input.data.code)}), expires_at=CASE WHEN code_hash=${digest(input.data.token+input.data.code)} THEN NOW()+INTERVAL '1 hour' ELSE expires_at END WHERE token_hash=${hash} AND expires_at>NOW() AND NOT verified AND attempts<5 RETURNING verified`;
  if(!rows[0]?.verified){res.status(400).json({error:'Invalid or expired code'});return;}
  res.json({verified:true});
});
demoRoutes.post('/send',async(req,res)=>{
  const input=z.object({token:tokenSchema,template:z.enum(['welcome','alert'])}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Invalid request'});return;}
  const hash=digest(input.data.token);
  try{
    const id=await prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{email:string}[]>`SELECT email FROM demo_session WHERE token_hash=${hash} AND verified AND expires_at>NOW()`;
      const email=rows[0]?.email;if(!email)return null;
      await quota(tx,'global',30);await quota(tx,'send:'+digest(email),5);
      return enqueue(tx,email,hash,templates[input.data.template],'demo-'+input.data.template);
    });
    if(!id){res.status(401).json({error:'Verify your email first'});return;}
    res.status(202).json({id,status:'pending'});
  }catch(e){if(e instanceof Error&&e.message==='DEMO_QUOTA'){res.status(429).json({error:'Demo sending limit reached'});return;}throw e;}
});
demoRoutes.post('/status',async(req,res)=>{
  const input=z.object({token:tokenSchema,id:z.uuid()}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'Invalid request'});return;}
  const hash=digest(input.data.token);
  const sessions=await prisma.$queryRaw<{email:string}[]>`SELECT email FROM demo_session WHERE token_hash=${hash} AND verified AND expires_at>NOW()`;
  if(!sessions.length){res.status(401).json({error:'Session expired'});return;}
  const row=await prisma.notification.findFirst({where:{id:input.data.id,caller_service:scope+hash},select:{status:true,attempts:true,created_at:true,updated_at:true,delivery_attempts:{select:{outcome:true,provider:true,started_at:true,finished_at:true}}}});
  if(!row){res.status(404).json({error:'Not found'});return;}
  res.json(row);
});
