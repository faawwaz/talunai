import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const names = {
  MockIDR: 'mockIdrAbi',
  RWARegistry: 'registryAbi',
  FinancingVault: 'vaultAbi',
  AgentExecutor: 'executorAbi',
};
let source = '// Generated from Foundry artifacts; regenerate with node contracts/script/export-abis.mjs.\n';
for (const [contract, exportName] of Object.entries(names)) {
  const artifact = JSON.parse(await readFile(path.join(root, 'contracts/out', `${contract}.sol`, `${contract}.json`), 'utf8'));
  if (!artifact.bytecode?.object || !Array.isArray(artifact.abi)) throw new Error(`Missing built contract ${contract}`);
  source += `export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n\n`;
}
await mkdir(path.join(root, 'packages/chain'), { recursive: true });
await writeFile(path.join(root, 'packages/chain/contracts.ts'), source);
console.log('Exported 4 contract ABIs to packages/chain/contracts.ts');
