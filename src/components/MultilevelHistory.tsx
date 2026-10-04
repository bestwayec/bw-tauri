import MockAssessmentHistory from '@/components/assessment/MockAssessmentHistory';
export default function MultilevelHistory({refreshKey}: {refreshKey: number}) {
  return <MockAssessmentHistory program="MULTILEVEL" refreshKey={refreshKey} />;
}
