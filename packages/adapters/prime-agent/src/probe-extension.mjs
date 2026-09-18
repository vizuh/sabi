import { appendFileSync } from 'node:fs';
import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';

export default function (pi) {
  const evidencePath = process.env.SABI_PRIME_PROBE_EVENTS;
  const native = process.env.SABI_PRIME_PROBE_VARIANT?.startsWith('native') === true;
  const save = (data) => appendFileSync(evidencePath, JSON.stringify(data) + '\n');
  pi.registerTool(defineTool({
    name: 'sabi_probe', label: 'Sabi synthetic probe',
    description: 'Return a synthetic step receipt. Does not access files, shell, or network.',
    parameters: Type.Object({ step: Type.Integer({ minimum: 1, maximum: 3 }) }),
    async execute(toolCallId, params, signal) {
      save({type:'synthetic_tool',toolCallId,step:params.step,aborted:signal?.aborted === true});
      return {content:[{type:'text',text:`probe-step-${params.step}-ok`}],details:{step:params.step}};
    },
  }));
  pi.on('session_start', (_event, ctx) => {
    save({type:'session_start',sessionId:ctx.sessionManager.getSessionId(),persisted:ctx.sessionManager.getSessionFile() !== undefined});
  });
  pi.on('turn_start', async (event,ctx) => {
    save({type:'turn_start',turnIndex:event.turnIndex,sessionId:ctx.sessionManager.getSessionId(),model:ctx.model?.id,effort:pi.getThinkingLevel()});
    if (native) {
      const target = [{model:'probe-first',effort:'low'},{model:'probe-second',effort:'high'},{model:'probe-first',effort:'minimal'}][event.turnIndex];
      if (!target) {ctx.abort();return;}
      const model = ctx.modelRegistry.find('sabi-local-probe',target.model);
      if (!model) throw new Error('Missing local mock model');
      const accepted = await pi.setModel(model);
      pi.setThinkingLevel(target.effort);
      save({type:'setters_returned',turnIndex:event.turnIndex,accepted,requestedModel:target.model,requestedEffort:target.effort,visibleModel:ctx.model?.id,visibleEffort:pi.getThinkingLevel()});
    }
  });
  pi.on('before_provider_request',(event,ctx) => {
    save({type:'before_provider_request',sessionId:ctx.sessionManager.getSessionId(),model:event.payload.model,effort:event.payload.reasoning_effort ?? null});
  });
  pi.on('turn_end',(event,ctx) => {
    save({type:'turn_end',turnIndex:event.turnIndex,sessionId:ctx.sessionManager.getSessionId(),model:event.message?.model,toolResults:event.toolResults?.length});
  });
}
