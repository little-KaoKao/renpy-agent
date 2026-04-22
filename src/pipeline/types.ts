export interface PlannerOutputCharacter {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
}

export interface PlannerOutputScene {
  readonly name: string;
  readonly description: string;
}

export interface PlannerOutput {
  readonly projectTitle: string;
  readonly genre: string;
  readonly tone: string;
  readonly characters: ReadonlyArray<PlannerOutputCharacter>;
  readonly scenes: ReadonlyArray<PlannerOutputScene>;
  readonly chapterOutline: string;
}

export interface WriterOutputLine {
  readonly speaker: string;
  readonly text: string;
  readonly emotion?: string;
  readonly direction?: string;
}

export interface WriterOutputScene {
  readonly location: string;
  readonly characters: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<WriterOutputLine>;
}

export interface WriterOutput {
  readonly scenes: ReadonlyArray<WriterOutputScene>;
}

export interface StoryboarderOutputDialogueLine {
  readonly speaker: string;
  readonly text: string;
}

/**
 * 视频类镜头(Cutscene)。分镜师决定某个镜头走视频路径时,在 shot 上挂这个字段。
 * - `kind='transition'`:片头/片尾/章节过场 CG,通常只吃场景首帧。
 * - `kind='reference'`:关键剧情 CG(吻戏/战斗/死亡等),需要角色 + 场景参考图。
 *
 * 占位原则同 Stage A:referenceSceneName / referenceCharacterName 是逻辑引用,
 * 真资产 URI 由 Stage B 从 AssetRegistry 里反查出来喂给 RunningHub。
 */
export interface StoryboarderOutputCutscene {
  readonly kind: 'transition' | 'reference';
  readonly motionPrompt: string;
  readonly referenceSceneName?: string;
  readonly referenceCharacterName?: string;
}

export interface StoryboarderOutputShot {
  readonly shotNumber: number;
  readonly description: string;
  readonly characters: ReadonlyArray<string>;
  readonly sceneName: string;
  readonly staging: string;
  readonly transforms: string;
  readonly transition: string;
  readonly effects?: string;
  readonly dialogueLines: ReadonlyArray<StoryboarderOutputDialogueLine>;
  readonly cutscene?: StoryboarderOutputCutscene;
}

export interface StoryboarderOutput {
  readonly shots: ReadonlyArray<StoryboarderOutputShot>;
}

export interface TestRunResult {
  readonly result: 'pass' | 'fail' | 'skipped';
  readonly syntaxErrors: ReadonlyArray<string>;
  readonly runtimeErrors: ReadonlyArray<string>;
  readonly warningMessage?: string;
}

export interface PipelineResult {
  readonly storyName: string;
  readonly gamePath: string;
  readonly planner: PlannerOutput;
  readonly writer: WriterOutput;
  readonly storyboarder: StoryboarderOutput;
  readonly testRun: TestRunResult;
}
