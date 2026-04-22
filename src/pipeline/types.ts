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
