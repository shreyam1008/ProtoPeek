import { type ExtensionId, isExtensionId } from './extension-catalog';
import type { ExtensionPack } from './extension-pack';

// The fixed glob is compiled into separate chunks. It never fetches or executes vendor code.
const packs = import.meta.glob<{ default: ExtensionPack }>('./extension-packs/extension-*.ts');
export async function loadExtensionPack(id: ExtensionId): Promise<ExtensionPack> {
  if (!isExtensionId(id)) throw new Error('This extension is not in the library.');
  const load = packs[`./extension-packs/extension-${id}.ts`];
  if (!load) throw new Error('This extension’s setup content is unavailable in this build.');
  return (await load()).default;
}
