import type { ScheduleItem, WeekDay } from "../lib/group-contract.generated";

const days: WeekDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const inputStyle = "rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm";

export function ClassroomSchedule({ slots, onChange }: { slots: ScheduleItem[]; onChange: (slots: ScheduleItem[]) => void }) {
  function editSlot(index: number, patch: Partial<ScheduleItem>) {
    onChange(slots.map((slot, item) => index === item ? { ...slot, ...patch } : slot));
  }

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-medium">Dars jadvali</legend>
      {slots.map((slot, index) => (
        <div className="flex flex-wrap items-end gap-2" key={index}>
          <label className="grid gap-1">Kun
            <select className={inputStyle} value={slot.day} onChange={event => editSlot(index, { day: event.target.value as WeekDay })}>
              {days.map(day => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
          <label className="grid gap-1">Boshlanish
            <input className={inputStyle} type="time" value={slot.startTime} onChange={event => editSlot(index, { startTime: event.target.value })} required />
          </label>
          <label className="grid gap-1">Tugash
            <input className={inputStyle} type="time" value={slot.endTime} onChange={event => editSlot(index, { endTime: event.target.value })} required />
          </label>
          <button type="button" className={inputStyle} onClick={() => onChange(slots.filter((_, item) => item !== index))}>Vaqtni o‘chirish</button>
        </div>
      ))}
      <button type="button" className={inputStyle} disabled={slots.length >= 28}
        onClick={() => onChange([...slots, { day: "mon", startTime: "09:00", endTime: "10:00" }])}>Dars vaqtini qo‘shish</button>
    </fieldset>
  );
}
