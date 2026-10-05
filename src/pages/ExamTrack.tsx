import { ExamTracks } from '@/components/ExamTracks';

export default function ExamTrack({ onBrowse }: { onBrowse: () => void }) {
  return <section>
    <h1 className="text-2xl font-bold">Student Exam Track</h1>
    <p className="mt-2 text-sm text-white/60">Choose the program for your dashboard, exams and history. Your selection is saved to your account and your other program's attempts stay available when you switch back.</p>
    <ExamTracks />
    <button type="button" className="btn-brand rounded-xl px-4 py-2.5 text-sm font-bold" onClick={onBrowse}>Browse exams</button>
  </section>;
}
