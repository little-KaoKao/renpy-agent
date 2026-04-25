import { stubTool, type PocToolSet, type ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc } from '../../agents/workspace-io.js';
import { writeGameProject } from '../../pipeline/coder.js';
import type { StoryboarderOutput } from '../../pipeline/types.js';
import { assemblePlannerOutput } from '../storyboarder/tools.js';

const write_game_project: ToolExecutor = async (_args, ctx) => {
  const planner = await assemblePlannerOutput(ctx.gameDir);
  if (typeof planner === 'string') {
    return { error: `write_game_project: ${planner}` };
  }

  const storyboard = await readWorkspaceDoc<StoryboarderOutput>(
    'workspace://storyboard',
    ctx.gameDir,
  );
  if (!storyboard) {
    return { error: 'write_game_project: storyboard not found at workspace://storyboard' };
  }

  await writeGameProject({
    gameDir: ctx.gameDir,
    planner,
    storyboarder: storyboard,
  });
  ctx.logger.info('coder.write_game_project', { shots: storyboard.shots.length });
  return {
    gameDir: ctx.gameDir,
    shotCount: storyboard.shots.length,
  };
};

// swap_asset_placeholder needs asset-type + remoteUrl + targetRelativePath,
// which the Planner doesn't naturally know in v0.6. The 修改链条 flow (v0.7)
// wires these fields through; for Stage A happy path the swap is handled
// internally by generate_*_image task agents.
const swap_asset_placeholder_stub = stubTool(
  'swap_asset_placeholder',
  'Swap a placeholder LogicalKey to a real asset URI (Tier 1 but deferred to v0.7 修改链条).',
);

export const coderTools: PocToolSet = {
  schemas: [
    {
      name: 'write_game_project',
      description:
        'Assemble project + chapter + characters + scenes + storyboard from workspace and write Ren\'Py files to gameDir.',
      inputSchema: { type: 'object', properties: {} },
    },
    swap_asset_placeholder_stub.schema,
  ],
  executors: {
    write_game_project,
    swap_asset_placeholder: swap_asset_placeholder_stub.executor,
  },
};
