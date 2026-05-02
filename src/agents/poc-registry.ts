// V5 POC role registry. Each POC's identity = the set of tool names they can
// invoke. The actual tool schemas + implementations live in src/executers/<poc>/tools.ts
// (built in M3); this registry only enumerates role metadata so the Planner can
// hand off to a role and the Executer knows what tool-set to load.

export type PocRole =
  | 'producer'
  | 'writer'
  | 'storyboarder'
  | 'character_designer'
  | 'scene_designer'
  | 'music_director'
  | 'voice_director'
  | 'sfx_designer'
  | 'ui_designer'
  | 'coder'
  | 'qa';

export const POC_ROLES: ReadonlyArray<PocRole> = [
  'producer',
  'writer',
  'storyboarder',
  'character_designer',
  'scene_designer',
  'music_director',
  'voice_director',
  'sfx_designer',
  'ui_designer',
  'coder',
  'qa',
];

export type PocTier = 1 | 2;

export interface PocDescriptor {
  readonly role: PocRole;
  readonly tier: PocTier;
  readonly description: string;
  readonly toolNames: ReadonlyArray<string>;
}

export const POC_REGISTRY: Readonly<Record<PocRole, PocDescriptor>> = {
  producer: {
    role: 'producer',
    tier: 1,
    description:
      '制作人:决定项目定位、章节大纲。用 create_project / create_chapter 在 workspace 建立骨架。',
    toolNames: ['create_project', 'create_chapter'],
  },
  writer: {
    role: 'writer',
    tier: 1,
    description: '编剧:根据章节大纲、角色、场景,写出逐行对白剧本(Script)。',
    toolNames: ['draft_script'],
  },
  storyboarder: {
    role: 'storyboarder',
    tier: 1,
    description: '分镜师:把 Script 凝练成 Shot 序列,决定每个 Shot 的视觉和情绪锚点。',
    toolNames: ['condense_to_shots', 'generate_cutscene'],
  },
  character_designer: {
    role: 'character_designer',
    tier: 1,
    description:
      '角色设计师:维护角色 visualDescription,生成/重生主图,未来还管表情、立绘动画。',
    toolNames: [
      'create_or_update_character',
      'generate_character_main_image',
      'generate_character_expression',
      'generate_character_dynamic_sprite',
    ],
  },
  scene_designer: {
    role: 'scene_designer',
    tier: 1,
    description: '场景设计师:维护 Scene,生成背景图、道具、时间变体。',
    toolNames: [
      'create_or_update_scene',
      'generate_scene_background',
      'generate_prop',
      'generate_scene_time_variant',
    ],
  },
  music_director: {
    role: 'music_director',
    tier: 2,
    description:
      '音乐总监:章节级 BGM 生成(SunoV5),落 workspace://bgmTrack/<slug>。',
    toolNames: ['generate_bgm_track'],
  },
  voice_director: {
    role: 'voice_director',
    tier: 2,
    description:
      '配音导演:基于 Storyboard 的单句对白 TTS(Qwen3),落 workspace://voiceLine/shot_<N>_line_<i>。',
    toolNames: ['generate_voice_line'],
  },
  sfx_designer: {
    role: 'sfx_designer',
    tier: 2,
    description:
      '音效设计师:Shot × cue 级环境音效(临时复用 Qwen3),落 workspace://sfx/shot_<N>_<cue>。',
    toolNames: ['generate_sfx'],
  },
  ui_designer: {
    role: 'ui_designer',
    tier: 2,
    description:
      'UI 设计师:Ren\'Py screens.rpy mood patch(LLM tool_use + deterministic renderer),落 workspace://uiDesign/<screen>。',
    toolNames: ['generate_ui_patch'],
  },
  coder: {
    role: 'coder',
    tier: 1,
    description:
      'Ren\'Py 编码师:把 Storyboard + Script + Character + Scene 拼装成 .rpy,并管理占位替换。',
    toolNames: ['write_game_project', 'swap_asset_placeholder'],
  },
  qa: {
    role: 'qa',
    tier: 1,
    description:
      'QA:跑 renpy lint;失败时用 kick_back_to_coder 归档 BugReport(workspace://bugReport/<id>),让 Planner 读后决定是否 re-handoff coder。' +
      '\n\n硬规则:run_qa 前必须先用 read_from_uri 抽查关键文档(character × scene × storyboard × script)做 cross-check。' +
      'Executer 会统计本次 handoff 内 read_from_uri 的次数;低于 max(5, ceil(workspace 文档总数 / 2)) 时 run_qa 会被拒绝执行(error + retry:false)。' +
      'lint 只管 Ren\'Py 语法,跨文档引用一致性(storyboard 里角色名 vs character 文档、scene slug、script line index)只能靠读。',
    toolNames: ['run_qa', 'kick_back_to_coder'],
  },
};

export function isPocRole(value: string): value is PocRole {
  return (POC_ROLES as ReadonlyArray<string>).includes(value);
}

export function getPocDescriptor(role: PocRole): PocDescriptor {
  const d = POC_REGISTRY[role];
  if (!d) throw new Error(`unknown POC role: ${role}`);
  return d;
}
