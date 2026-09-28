import { timingSafeEqual } from 'node:crypto';
import { generateNews } from './news.js';
import { cronSlot, runEditorialRequest } from '../lib/editorial-execution.mjs';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Método não permitido.'});
  const secret=process.env.SUPABASE_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if(!secret) return res.status(503).json({error:'Cron não configurado.'});
  const provided=req.headers?.authorization;
  const expected=Buffer.from(`Bearer ${secret}`);
  if(typeof provided!=='string' || Buffer.byteLength(provided)!==expected.length ||
      !timingSafeEqual(Buffer.from(provided),expected)) return res.status(401).json({error:'Acesso não autorizado.'});
  if(process.env.VERCEL_ENV && process.env.VERCEL_ENV!=='production') {
    return res.status(409).json({error:'O cron está disponível somente em produção.'});
  }
  const request={method:'POST',body:{}};
  const result=await runEditorialRequest({source:'cron',slot:cronSlot()},(output,run)=>generateNews(request,output,run));
  return res.status(result.status).json(result.body);
}
