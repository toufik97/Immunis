import { z } from "zod";

export const AppointmentSchema = z.object({
  id: z.string().min(1),
  childId: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedProducts: z.array(z.string().min(1)).default([]),
  kept: z.boolean().nullable().default(null),
});

export type Appointment = z.infer<typeof AppointmentSchema>;
