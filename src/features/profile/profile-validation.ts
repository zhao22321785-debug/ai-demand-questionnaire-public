import type { UserProfileInput } from '../../types/survey';

export function isCompleteUserProfile(
  profile: UserProfileInput | null | undefined,
): profile is UserProfileInput {
  if (!profile?.name.trim() || !profile.departmentId || !profile.positionId || !profile.currentPositionExperience) return false;
  if (profile.departmentId === 'other' && !profile.departmentOther?.trim()) return false;
  if (profile.positionId === 'other' && !profile.positionOther?.trim()) return false;
  return true;
}
