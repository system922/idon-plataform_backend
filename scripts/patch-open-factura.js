/**
 * patch-open-factura.js
 * Corrige bugs en open-factura@0.1.1 que hacen que el SRI Ecuador
 * rechace los comprobantes electrónicos con error de estructura/firma.
 *
 * Bug 1: xmlns:ds namespace typo ("xmldisg" → "xmldsig")
 * Bug 2: Transform URI typo ("xmlndsig" → "xmldsig")
 * Bug 3: SignatureMethod attribute typo ("Algorith" → "Algorithm")
 * Bug 4: sha1SignedProperties replace nunca coincidía ("ets:" → "etsi:")
 * Bug 5: Root <factura> tiene xmlns:ds y xmlns:xsi — contamina el contexto C14N
 *        de todos los elementos dentro de <ds:Signature>
 * Bug 6: XML declaration strip pattern incorrecto (no strippeaba la declaración real)
 * Bug 7: ObjectReference usa "=" como separador en lugar de nada
 * Bug 8: La firma RSA se corrompe insertando \n en bytes binarios antes de btoa()
 * Bug 9: Extracción de clave para certs del Banco Central usa índice incorrecto
 *        (pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag[i]] indexa el OID como string
 *         en vez de usar el array ya extraído → pkcs8 = undefined → crash)
 * Bug 10: Sin fallback para CA distintas de "SECURITY DATA" y "BANCO CENTRAL"
 *         (ANF, UANATACA, LAZZATE, etc.) → pkcs8 = undefined → crash antes del SRI
 *
 * Se ejecuta automáticamente vía "postinstall" después de npm install.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '../node_modules/open-factura/dist/index.js');

let src;
try {
  src = readFileSync(target, 'utf8');
} catch {
  console.warn('[patch-open-factura] No se encontró open-factura, saltando parche.');
  process.exit(0);
}

const patched = src
  // Bug 1: xmlns:ds namespace typo ("xmldisg" → "xmldsig")
  .replace(
    /http:\/\/www\.w3\.org\/2000\/09\/xmldisg#/g,
    'http://www.w3.org/2000/09/xmldsig#'
  )
  // Bug 2: Transform URI typo ("xmlndsig" → "xmldsig")
  .replace(
    /xmlndsig#enveloped-signature/g,
    'xmldsig#enveloped-signature'
  )
  // Bug 3: SignatureMethod attribute typo ("Algorith" → "Algorithm")
  .replace(
    /SignatureMethod Algorith="/g,
    'SignatureMethod Algorithm="'
  )
  // Bug 4: sha1SignedProperties replace never matched ("ets:" → "etsi:")
  .replace(
    /"<ets:SignedProperties"/g,
    '"<etsi:SignedProperties"'
  )
  // Bug 5: Root <factura> must NOT carry xmlns:ds / xmlns:xsi — those declarations
  //        on the root element leak into every C14N context inside <ds:Signature>,
  //        causing all namespace-sensitive digests to mismatch what SRI computes.
  .replace(
    /("@xmlns:ds":\s*"[^"]*",?\s*\n\s*"@xmlns:xsi":\s*"[^"]*",?\s*\n\s*"@id")/,
    '"@id"'
  )
  // Bug 6: XML declaration strip used wrong literal; use a regex that matches any
  //        form of <?xml ... ?> so the declaration is never included in sha1_xml.
  .replace(
    /xml\.replace\('(<\?xml version="1\.0" encoding="UTF-8"\?>)', ""\)/,
    'xml.replace(/<\\?xml[^?]*\\?>\\r?\\n?/, "")'
  )
  // Bug 7: ObjectReference="#Reference-ID=<n>" should be "#Reference-ID<n>"
  .replace(
    /"#Reference-ID='\s*\+\s*referenceIdNumber/g,
    '"#Reference-ID" + referenceIdNumber'
  )
  // Bug 8 (CRÍTICO): La firma RSA se corrompe insertando \n en los bytes binarios
  //   ANTES de btoa(). Eso añade bytes 0x0A al payload, el SRI decodifica bytes
  //   adicionales → RSA verification fails → FIRMA INVÁLIDA.
  //   Fix: btoa() primero (encode bytes → base64 chars), LUEGO opcional split.
  .replace(
    /const signature = btoa\(\s*key\.sign\(md2\)\.match\(\.\{1,76\}\/g\)\.join\("\\n"\)\s*\);/,
    'const signature = btoa(key.sign(md2));'
  )
  // Bug 9 (CRÍTICO): Banco Central — extracción de clave usa índice incorrecto.
  //   forge.oids.pkcs8ShroudedKeyBag es un string OID (ej. "1.2.840.113549.1.12.10.1.2"),
  //   indexar con [i] devuelve un carácter del OID, no un bag → pkcs8 = undefined.
  //   Fix: usar el array "keys" que ya se extrajo arriba con getBags().
  .replace(
    'pkcs8 = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag[i]];',
    'pkcs8 = keys[i];'
  )
  // Bug 10: Sin fallback para CA distintas de SECURITY DATA / BANCO CENTRAL.
  //   ANF, UANATACA, LAZZATE y otras CA ecuatorianas dejan pkcs8 = undefined,
  //   el acceso a pkcs8.key lanza TypeError antes de llegar al SRI.
  //   Fix: después de los dos if de CA, intentar el primer bag disponible.
  .replace(
    /if \(\/SECURITY DATA\/i\.test\(friendlyName\)\) \{\s*pkcs8 = pkcs8Bags\[forge\.oids\.pkcs8ShroudedKeyBag\]\[0\];\s*\}/,
    `if (/SECURITY DATA/i.test(friendlyName)) {
    pkcs8 = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag][0];
  }
  // Fallback: cualquier otra CA ecuatoriana (ANF, UANATACA, LAZZATE, etc.)
  if (!pkcs8) {
    const allBags = pkcs8Bags[forge.oids.pkcs8ShroudedKeyBag];
    pkcs8 = Array.isArray(allBags) ? allBags[0] : allBags;
  }`
  );

if (patched === src) {
  console.log('[patch-open-factura] Ya está parcheado, nada que hacer.');
} else {
  writeFileSync(target, patched, 'utf8');
  console.log('[patch-open-factura] Parche aplicado correctamente.');
}
