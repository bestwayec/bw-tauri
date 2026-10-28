import type { MockSkill } from './mocks';
import { belongsToProgram, type ExamProgram, type PracticeLevel } from './programs';

export const SKILL_CATEGORIES = ['all', 'full_mock', 'listening', 'reading', 'writing', 'speaking'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export type CatalogueCategory = SkillCategory;

export interface CatalogueContext {
  type: string;
  profile?: string | null;
  level?: string | null;
  practiceLevel?: PracticeLevel | null;
  skills?: readonly string[];
  sections?: readonly string[];
}

export interface CatalogueFilter {
  level?: PracticeLevel | 'All';
  category?: CatalogueCategory;
}

const ALL_SKILLS: readonly MockSkill[] = ['listening', 'reading', 'writing', 'speaking'];

export function isFullMock(item: { profile?: string | null; skills?: readonly string[]; sections?: readonly string[] }): boolean {
  if (item.profile === 'full_mock') return true;
  if (item.profile && item.profile !== 'full_mock') return false;
  const list = item.skills ?? item.sections ?? [];
  return list.length > 0 && ALL_SKILLS.every((s) => list.includes(s));
}

/** Practice levels describe learning content; full mock estimates use a separate result scale. */
export function matchesCatalogue(
  item: CatalogueContext,
  program: ExamProgram,
  levelOrFilter: PracticeLevel | 'All' | CatalogueFilter = 'All',
  categoryArg: CatalogueCategory = 'all',
): boolean {
  if (!belongsToProgram(item.type, program)) return false;

  const level: PracticeLevel | 'All' =
    typeof levelOrFilter === 'object' && levelOrFilter !== null
      ? (levelOrFilter.level ?? 'All')
      : levelOrFilter;
  const category: CatalogueCategory =
    typeof levelOrFilter === 'object' && levelOrFilter !== null
      ? (levelOrFilter.category ?? 'all')
      : categoryArg;

  const skillList = item.skills ?? item.sections;

  if (program === 'IELTS') {
    if (!skillList) return true;
    if (category === 'all') return true;
    if (category === 'full_mock') return isFullMock(item);
    return skillList.includes(category);
  }

  if (level !== 'All' && (item.profile === 'full_mock' || item.practiceLevel !== level)) {
    return false;
  }
  if (category === 'full_mock') {
    return item.profile ? item.profile === 'full_mock' : isFullMock(item);
  }
  if (item.profile === 'full_mock' && category !== 'all') {
    return false;
  }
  return category === 'all' || (skillList ?? []).includes(category);
}
