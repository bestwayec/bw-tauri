import { recordingKey, retainRecording, releaseRecording } from './durable-recordings';
import { uploadMockSpeaking } from './mocks';

/** IELTS uses its existing timers, but completed takes share durable upload safety. */
export async function uploadRetainedMockRecording(attemptId: string, questionId: string, blob: Blob, onStorageUnavailable: () => void) {
  if (!blob.size) throw new Error('The microphone produced an empty recording.');
  const key = recordingKey(attemptId, questionId);
  // retainRecording keeps an in-memory copy even when IndexedDB is unavailable.
  await retainRecording(key, blob).catch(onStorageUnavailable);
  await uploadMockSpeaking(attemptId, questionId, blob);
  // A failed acknowledgement never releases the original take.
  await releaseRecording(key);
}
