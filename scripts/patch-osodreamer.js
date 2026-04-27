/**
 * patch-osodreamer.js
 * Corrige bugs en osodreamer-sri-xml-signer cuando se usa con Node.js ESM.
 *
 * Bug A: `import * as forge from "node-forge"` en ESM devuelve namespace
 *        con solo { default: ... } — forge.md es undefined.
 *        Fix: var forge = _forgeImport.default || _forgeImport;
 *
 * Bug B: Mismo problema para la variable forge2 en HashProviderImplement.
 *
 * Se ejecuta automáticamente vía "postinstall" después de npm install.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '../node_modules/osodreamer-sri-xml-signer/dist/index.mjs');

let src;
try {
  src = readFileSync(target, 'utf8');
} catch {
  console.warn('[patch-osodreamer] No se encontró osodreamer-sri-xml-signer, saltando parche.');
  process.exit(0);
}

const patched = src
  // Bug A: ForgeRsaSha1Signer — forge.md.sha1 undefined en ESM
  .replace(
    '// src/sign-xml/infrastructure/forge-rsa-sha1-signer.implementation.ts\nimport * as forge from "node-forge";',
    '// src/sign-xml/infrastructure/forge-rsa-sha1-signer.implementation.ts\nimport * as _forgeImport from "node-forge";\nvar forge = _forgeImport.default || _forgeImport;'
  )
  // Bug B: HashProviderImplement — forge2.md.sha1 undefined en ESM
  .replace(
    '// src/sign-xml/infrastructure/hash/hash-provider.implement.ts\nimport * as forge2 from "node-forge";',
    '// src/sign-xml/infrastructure/hash/hash-provider.implement.ts\nimport * as _forge2Import from "node-forge";\nvar forge2 = _forge2Import.default || _forge2Import;'
  );

if (patched === src) {
  console.log('[patch-osodreamer] Ya está parcheado, nada que hacer.');
} else {
  writeFileSync(target, patched, 'utf8');
  console.log('[patch-osodreamer] Parche aplicado correctamente (2 correcciones ESM forge).');
}
