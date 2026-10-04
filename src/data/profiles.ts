import type { UserProfile } from '@/types';

export const profilePlaceholders: UserProfile[] = [
  {
    id: 'profile-child',
    displayName: 'Child Profile',
    ageGroup: 'child',
    primaryLanguage: 'bilingual',
    avatarColor: 'bg-sky-600',
    communicationPreference: 'sentence',
  },
  {
    id: 'profile-teen',
    displayName: 'Teen Profile',
    ageGroup: 'teen',
    primaryLanguage: 'bilingual',
    avatarColor: 'bg-emerald-600',
    communicationPreference: 'word',
  },
  {
    id: 'profile-adult',
    displayName: 'Adult Profile',
    ageGroup: 'adult',
    primaryLanguage: 'bilingual',
    avatarColor: 'bg-violet-700',
    communicationPreference: 'sentence',
  },
];
