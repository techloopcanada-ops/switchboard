import fs from 'node:fs';
import path from 'node:path';
import { Cron } from 'croner';
import YAML from 'yaml';
import { homeDir } from './config.ts';

export type WorkflowTrigger =
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'command'; command: string }
  | { type: 'manual' };

export interface WorkflowDeliver {
  channel: string;
  chatId: string;
}

export interface Workflow {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  bot: string;
  prompt: string;
  deliver: WorkflowDeliver[];
  /** inherit = the bot's own policy; auto = approve everything (unattended); never = block anything that needs approval. */
  approval: 'inherit' | 'auto' | 'never';
  /** Start from an empty transcript each run (default true). */
  freshSession: boolean;
  file: string;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function workflowsDir(): string {
  return path.join(homeDir(), 'workflows');
}

export function parseWorkflow(yamlText: string, file: string): Workflow {
  const raw = YAML.parse(yamlText) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Workflow must be a YAML mapping.');
  const w = raw as Record<string, unknown>;
  if (typeof w.name !== 'string' || !NAME.test(w.name)) throw new Error('Workflow name must be lowercase letters, digits and hyphens.');
  if (typeof w.bot !== 'string' || !w.bot) throw new Error('Workflow needs a bot id.');
  if (typeof w.prompt !== 'string' || !w.prompt.trim()) throw new Error('Workflow needs a prompt.');
  const t = (w.trigger ?? { type: 'manual' }) as Record<string, unknown>;
  let trigger: WorkflowTrigger;
  if (t.type === 'cron') {
    if (typeof t.expression !== 'string') throw new Error('Cron trigger needs an expression.');
    try {
      new Cron(t.expression, { paused: true, timezone: typeof t.timezone === 'string' ? t.timezone : undefined }).stop();
    } catch (error) {
      throw new Error(`Invalid cron expression "${t.expression}": ${(error as Error).message}`);
    }
    trigger = { type: 'cron', expression: t.expression, timezone: typeof t.timezone === 'string' ? t.timezone : undefined };
  } else if (t.type === 'command') {
    if (typeof t.command !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(t.command)) throw new Error('Command trigger needs a short command name.');
    trigger = { type: 'command', command: t.command };
  } else if (t.type === 'manual' || t.type === undefined) {
    trigger = { type: 'manual' };
  } else {
    throw new Error(`Unknown trigger type "${String(t.type)}". Use cron, command or manual.`);
  }
  const deliver: WorkflowDeliver[] = [];
  if (Array.isArray(w.deliver)) {
    for (const d of w.deliver as Record<string, unknown>[]) {
      if (!d || typeof d.channel !== 'string' || (typeof d.chatId !== 'string' && typeof d.chatId !== 'number')) throw new Error('Each deliver entry needs channel and chatId.');
      deliver.push({ channel: d.channel, chatId: String(d.chatId) });
    }
  }
  const approval = w.approval === 'auto' || w.approval === 'never' ? w.approval : 'inherit';
  return {
    name: w.name,
    description: typeof w.description === 'string' ? w.description : undefined,
    trigger,
    bot: w.bot,
    prompt: w.prompt,
    deliver,
    approval,
    freshSession: w.freshSession !== false,
    file,
  };
}

export function loadWorkflows(): { workflows: Workflow[]; errors: Record<string, string> } {
  const dir = workflowsDir();
  const workflows: Workflow[] = [];
  const errors: Record<string, string> = {};
  if (!fs.existsSync(dir)) return { workflows, errors };
  for (const file of fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort()) {
    const full = path.join(dir, file);
    try {
      workflows.push(parseWorkflow(fs.readFileSync(full, 'utf8'), full));
    } catch (error) {
      errors[file] = (error as Error).message;
    }
  }
  return { workflows, errors };
}

export function saveWorkflowYaml(name: string, yamlText: string): Workflow {
  if (!NAME.test(name)) throw new Error('Workflow file name must be lowercase letters, digits and hyphens.');
  const file = path.join(workflowsDir(), `${name}.yaml`);
  const parsed = parseWorkflow(yamlText, file);
  if (parsed.name !== name) throw new Error(`Workflow name "${parsed.name}" must match the file name "${name}".`);
  fs.mkdirSync(workflowsDir(), { recursive: true });
  fs.writeFileSync(file, yamlText);
  return parsed;
}

export function deleteWorkflow(name: string): boolean {
  const file = path.join(workflowsDir(), `${name}.yaml`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function workflowToYaml(input: { name: string; cron?: string; bot: string; prompt: string; deliver?: WorkflowDeliver[]; description?: string }): string {
  const doc: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? `Created by a bot on ${new Date().toISOString().slice(0, 10)}`,
    trigger: input.cron ? { type: 'cron', expression: input.cron } : { type: 'manual' },
    bot: input.bot,
    prompt: input.prompt,
    deliver: input.deliver ?? [],
    approval: 'inherit',
    freshSession: true,
  };
  return YAML.stringify(doc);
}

/** Runs cron-triggered workflows. `run` is provided by the runtime. */
export class WorkflowScheduler {
  private jobs = new Map<string, Cron>();
  private readonly run: (workflow: Workflow, reason: string) => Promise<void>;

  constructor(run: (workflow: Workflow, reason: string) => Promise<void>) {
    this.run = run;
  }

  reload(workflows: Workflow[]): void {
    this.stop();
    for (const w of workflows) {
      if (w.trigger.type !== 'cron') continue;
      const job = new Cron(w.trigger.expression, { timezone: w.trigger.timezone, protect: true }, () => {
        this.run(w, 'cron').catch(error => console.error(`Workflow ${w.name} failed: ${(error as Error).message}`));
      });
      this.jobs.set(w.name, job);
    }
  }

  nextRuns(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [name, job] of this.jobs) out[name] = job.nextRun()?.toISOString() ?? null;
    return out;
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }
}
