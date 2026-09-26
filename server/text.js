// Takım adlarını karşılaştırmak için: küçük harf, Türkçe/aksanlı harfler sadeleşir, işaretler boşluk olur.
export function normalize(text) {
  return String(text ?? '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
