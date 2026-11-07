import manifest from './community-catalog.json';

export type CommunityExtension = {
  id: string;
  name: string;
  description: string;
  group: string;
  license: string;
  source: string;
};

export const communityCatalog = manifest as readonly CommunityExtension[];

export function communityExtension(id: string): CommunityExtension | undefined {
  return communityCatalog.find((entry) => entry.id === id);
}
