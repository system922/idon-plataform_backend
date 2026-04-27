import { parseStringPromise } from 'xml2js';

export async function safeXmlToJson(xmlStr) {
  try {
    const obj = await parseStringPromise(xmlStr, { explicitArray: false, trim: true });
    return obj;
  } catch (e) {
    return { error: 'XML parse failed', raw: xmlStr, detail: e.message };
  }
}