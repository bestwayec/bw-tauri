import { describe, expect, it } from 'vitest';
import { MockSubmitResultSchema } from './schemas';
import { recordingKey, markActiveRecording, hasActiveRecording } from './durable-recordings';
import { mockKindOf } from '@/components/exam-ui/model';

describe('Multilevel desktop contracts and recovery',()=>{
  it('accepts estimated standard scores without requiring an IELTS band',()=>{
    const result=MockSubmitResultSchema.parse({status:'grading',rawScores:{listening:{score:18,max:35}},sectionBands:null,overallBand:null,cefrLevel:null,overallScore:null,specificationVersion:'UZBMB_MULTILEVEL_EN_2026_V1',scoreMethod:'ESTIMATED',scoreVersion:'estimate-v1',standardScores:{listening:{estimatedStandardScore:51,isOfficial:false}}});
    expect(result.standardScores?.listening.estimatedStandardScore).toBe(51);
    expect(result.overallBand).toBeNull();
  });
  it('keeps response recordings isolated by attempt and blocks active finalization',()=>{
    const key=recordingKey('attempt-a','question');
    expect(key).not.toBe(recordingKey('attempt-b','question'));
    markActiveRecording(key,true);
    expect(hasActiveRecording('attempt-a')).toBe(true);
    expect(hasActiveRecording('attempt-b')).toBe(false);
    markActiveRecording(key,false);
    expect(hasActiveRecording('attempt-a')).toBe(false);
  });
  it.each(['multiple_choice','short_answer','note_completion','matching','matching_headings','true_false_notgiven','sentence_completion','summary_completion','essay_task1','essay_task2','speaking_task'] as const)('reuses the existing renderer for %s',type=>{
    expect(mockKindOf({type} as never)).toBeTruthy();
  });
  it('rejects unsupported result state',()=>{
    expect(MockSubmitResultSchema.safeParse({status:'invented',rawScores:{},sectionBands:null,overallBand:null,cefrLevel:null}).success).toBe(false);
  });
});
