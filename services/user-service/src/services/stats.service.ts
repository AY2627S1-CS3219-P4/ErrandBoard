import { User } from "../models/User.js";

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  users: number;        // accountType === "USER"
  admins: number;       // accountType === "ADMIN"
  superadmins: number;  // accountType === "SUPERADMIN"
}

// admin-scoped read: platform-wide user statistics for the admin dashboard.
// authorization is enforced at the route via requireAdmin.
export async function getUserStats(): Promise<UserStats> {
  const [activeUsers, inactiveUsers, byRole] = await Promise.all([
    // isActive defaults to true and older docs may lack the field, so "active" = not explicitly false
    User.countDocuments({ isActive: { $ne: false } }),
    User.countDocuments({ isActive: false }),
    User.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$accountType", count: { $sum: 1 } } },
    ]),
  ]);

  const roleCounts = { USER: 0, ADMIN: 0, SUPERADMIN: 0 } as Record<string, number>;
  for (const row of byRole) {
    if (row._id in roleCounts) roleCounts[row._id] = row.count;
  }

  return {
    totalUsers: activeUsers + inactiveUsers,
    activeUsers,
    inactiveUsers,
    users: roleCounts.USER,
    admins: roleCounts.ADMIN,
    superadmins: roleCounts.SUPERADMIN,
  };
}
