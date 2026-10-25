import { z } from "zod";

export const RoleSchema = z.enum(["nurse", "admin", "reader"]);
export type Role = z.infer<typeof RoleSchema>;

/** Small fixed permission list; roles tick rights so new roles are easy later. */
export const PERMISSIONS = [
  "child.read",
  "child.create",
  "visit.record_centre",
  "visit.record_external",
  "visit.record_transition",
  "stock.read",
  "stock.add",
  "appointment.manage",
  "session.view",
  "prefs.view",
  "prefs.edit",
  "backup.export",
  "audit.view",
  "visit.void",
  /** Reserved: future doctor clinical sign-off on voids/invalidations (admin holds it in v1). */
  "visit.void_approve",
  "user.manage",
  "transition.grant",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  nurse: [
    "child.read",
    "child.create",
    "visit.record_centre",
    "visit.record_external",
    "stock.read",
    "appointment.manage",
    "session.view",
    "prefs.view",
  ],
  admin: [...PERMISSIONS] as Permission[],
  reader: ["child.read", "session.view", "prefs.view", "stock.read", "audit.view"],
};

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  fullName: z.string().min(1),
  role: RoleSchema,
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string().min(1),
  lastLoginAt: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  expiresAt: z.string().min(1),
  createdAt: z.string().min(1),
});
export type Session = z.infer<typeof SessionSchema>;
