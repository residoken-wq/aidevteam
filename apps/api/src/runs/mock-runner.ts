export interface MockRunnerInput {
  runId: string;
  attempt: number;
}

export interface MockRunner {
  run(input: MockRunnerInput): Promise<unknown>;
}

export const defaultMockRunner: MockRunner = {
  async run() {
    return { status: "SUCCESS", summary: "mock run" };
  },
};
