import { expect, it } from 'vitest';
import source from '../../../internal/communitytools/catalog.json';
import metadata from './community-catalog.json';

it('keeps the compact extension metadata aligned with the verified catalog', () => {
  expect(metadata).toEqual(
    source.map(({ id, name, group, description, license, source: project }) => ({
      id,
      name,
      group,
      description,
      license,
      source: project,
    }))
  );
});
