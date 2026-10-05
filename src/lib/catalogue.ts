import { belongsToProgram, type ExamProgram, type PracticeLevel } from './programs';

export type CatalogueCategory = 'all' | 'full_mock' | 'listening' | 'reading' | 'writing' | 'speaking';
export interface CatalogueContext {
  type: string;
  profile?: string;
  practiceLevel?: PracticeLevel | null;
  skills?: string[];
  sections?: string[];
}

/** Practice levels describe learning content; full mock estimates use a separate result scale. */
export function matchesCatalogue(item: CatalogueContext, program: ExamProgram, level: PracticeLevel | 'All', category: CatalogueCategory) {
  if (!belongsToProgram(item.type, program)) return false;
  if (program === 'IELTS') return true;
  if (level !== 'All' && (item.profile === 'full_mock' || item.practiceLevel !== level)) return false;
  if (category === 'full_mock') return item.profile === 'full_mock';
  return category === 'all' || (item.skills ?? item.sections ?? []).includes(category);
}
