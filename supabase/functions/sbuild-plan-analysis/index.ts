import { createPlanAnalysisHandler } from './handler.mjs';

Deno.serve(createPlanAnalysisHandler({
  enabled: Deno.env.get('SBUILD_PLAN_AI_ENABLED') === 'true',
  apiKey: Deno.env.get('OPENAI_API_KEY'),
  model: Deno.env.get('SBUILD_PLAN_AI_MODEL'),
  allowedOrigin: Deno.env.get('SBUILD_PLAN_AI_ORIGIN'),
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY'),
}));
