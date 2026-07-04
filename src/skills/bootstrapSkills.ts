/**
 * Seed skills that ship with the app. Written into `SkillStore` on first
 * launch (see `App.tsx`) with stable ids, so re-launching doesn't duplicate
 * them and a delete-then-launch doesn't resurrect them (the store's own
 * "create if missing" check on stable id gates that — see `App.tsx`).
 *
 * The first entry — `skill-authoring` — is deliberately the "skill for
 * making skills" the user asked for: a starter that teaches the format so
 * every skill added after it stays consistent.
 */

export interface BootstrapSkill {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}

export const SKILL_AUTHORING_ID = "kleep-builtin-skill-authoring";

export const BOOTSTRAP_SKILLS: readonly BootstrapSkill[] = [
  {
    id: SKILL_AUTHORING_ID,
    name: "Skill Authoring",
    description:
      "How to write a well-structured Kleep skill — name, description, whenToUse, and a tight body.",
    whenToUse:
      "When the user asks to author, refine, or restructure a skill; or when reviewing an existing skill for clarity.",
    body: [
      "A Kleep skill is a persistent instruction the model applies when a specific task or topic comes up. It has four parts:",
      "",
      "- **Name** — short and specific. Noun phrase or imperative. Avoid \"General Writing Skill\"; prefer \"Scene Openers\", \"Character Voice\", \"Villain Motivation\".",
      "- **Description** — one line, plain language, describing what the skill does. Not what it IS — what it DOES.",
      "- **WhenToUse** — one line, describing the trigger. What has to be true in the conversation for this skill to be worth applying. Model uses this to decide.",
      "- **Body** — the actual guidance. Concrete rules, examples, dos and don'ts. Written to a writer, not a model — a real human should be able to read it and understand the same thing the model will.",
      "",
      "**Do:**",
      "- Keep the body under ~500 words. Longer skills get skimmed and misapplied.",
      "- Include one concrete example when the guidance is subtle. Show, don't just tell.",
      "- Name the anti-pattern explicitly. \"Don't drop the sardonic edge in gentle moments\" beats \"maintain character consistency\".",
      "- Use lists when the skill is a checklist; use prose when it's a way of thinking.",
      "",
      "**Don't:**",
      "- Restate the persona. Skills are orthogonal to who's talking; they're about how to handle a *task*.",
      "- Overlap with an existing skill. If two skills fire on the same trigger, split their scopes cleanly first.",
      "- Encode preferences that are one-off. A skill is for something you'd apply repeatedly across chats. One-time asks belong in the message itself.",
      "",
      "**Example skill body** (for a hypothetical \"Character Voice\" skill):",
      "",
      "> Preserve the character's speech patterns established in prior scenes: sentence rhythm, vocabulary range, tics and hedges. If a character is described as sardonic, keep that tone even in gentle moments — layer the sardonic edge onto tenderness rather than dropping it. When a character's dialogue starts sounding like the narrator's voice, that's the warning sign to pull back.",
      "",
      "When drafting a new skill, propose all four parts back to the user for confirmation before saving. Skills are cheap to write and expensive to unlearn — better to reshape one during authoring than to accumulate near-duplicates.",
    ].join("\n"),
  },
];

/** Insert any bootstrap skill not yet present in `store`. Idempotent by id
 * so relaunching doesn't duplicate seeds, and deleting a seed keeps it
 * gone (we only insert when absent). */
export function seedBootstrapSkills(
  store: { get(id: string): unknown; create(skill: {
    id: string;
    name: string;
    description: string;
    whenToUse: string;
    body: string;
    now: number;
  }): unknown; },
  now: number,
): void {
  for (const skill of BOOTSTRAP_SKILLS) {
    if (store.get(skill.id)) continue;
    store.create({ ...skill, now });
  }
}
