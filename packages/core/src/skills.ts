import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { homeDir } from './config.ts';

/** An agentskills.io skill: metadata always in context, body loaded on demand. */
export interface Skill {
  name: string;
  description: string;
  dir: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  source: 'user' | 'bundled';
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function userSkillsDir(): string {
  return path.join(homeDir(), 'skills');
}

export function bundledSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
}

export interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseSkillFile(text: string): ParsedSkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter between --- lines.');
  const frontmatter = YAML.parse(match[1] ?? '') as unknown;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) throw new Error('SKILL.md frontmatter must be a mapping.');
  return { frontmatter: frontmatter as Record<string, unknown>, body: match[2] ?? '' };
}

export function validateSkillFrontmatter(frontmatter: Record<string, unknown>, dirName: string): Pick<Skill, 'name' | 'description' | 'license' | 'compatibility' | 'metadata'> {
  const name = frontmatter.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > 64 || !NAME_PATTERN.test(name)) {
    throw new Error('Skill name must be 1-64 lowercase letters, digits and single hyphens.');
  }
  if (name !== dirName) throw new Error(`Skill name "${name}" must match its directory name "${dirName}".`);
  const description = frontmatter.description;
  if (typeof description !== 'string' || !description.trim() || description.length > 1024) {
    throw new Error('Skill description must be 1-1024 characters.');
  }
  const compatibility = frontmatter.compatibility;
  if (compatibility !== undefined && (typeof compatibility !== 'string' || compatibility.length > 500)) {
    throw new Error('Skill compatibility must be text up to 500 characters.');
  }
  let metadata: Record<string, string> | undefined;
  if (frontmatter.metadata !== undefined) {
    if (!frontmatter.metadata || typeof frontmatter.metadata !== 'object') throw new Error('Skill metadata must be a mapping of strings.');
    metadata = {};
    for (const [k, v] of Object.entries(frontmatter.metadata as Record<string, unknown>)) metadata[k] = String(v);
  }
  return {
    name,
    description: description.trim(),
    license: typeof frontmatter.license === 'string' ? frontmatter.license : undefined,
    compatibility: typeof compatibility === 'string' ? compatibility : undefined,
    metadata,
  };
}

function scan(dir: string, source: Skill['source']): Skill[] {
  if (!fs.existsSync(dir)) return [];
  const skills: Skill[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const file = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = parseSkillFile(fs.readFileSync(file, 'utf8'));
      skills.push({ ...validateSkillFrontmatter(parsed.frontmatter, entry.name), dir: skillDir, source });
    } catch (error) {
      console.warn(`Skipping skill ${entry.name}: ${(error as Error).message}`);
    }
  }
  return skills;
}

/** User skills override bundled skills with the same name. */
export function loadSkills(): Skill[] {
  const user = scan(userSkillsDir(), 'user');
  const names = new Set(user.map(s => s.name));
  return [...user, ...scan(bundledSkillsDir(), 'bundled').filter(s => !names.has(s.name))].sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkillBody(skill: Skill): string {
  return parseSkillFile(fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8')).body.trim();
}

/** Resolve a file referenced from a skill, refusing paths outside the skill directory. */
export function readSkillResource(skill: Skill, relative: string): string {
  const target = path.resolve(skill.dir, relative);
  if (!target.startsWith(path.resolve(skill.dir) + path.sep)) throw new Error('Skill resources must live inside the skill directory.');
  return fs.readFileSync(target, 'utf8');
}

export function writeUserSkill(name: string, description: string, body: string): Skill {
  const meta = validateSkillFrontmatter({ name, description }, name);
  const dir = path.join(userSkillsDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  const text = `---\nname: ${meta.name}\ndescription: ${YAML.stringify(meta.description).trim()}\n---\n\n${body.trim()}\n`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
  return { ...meta, dir, source: 'user' };
}

/** Compact listing for a system prompt: name and description only (progressive disclosure step 1). */
export function skillsManifest(skills: Skill[]): string {
  if (!skills.length) return 'No skills installed.';
  return skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
}
