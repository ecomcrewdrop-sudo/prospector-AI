/**
 * fix-phones.js — Script de limpieza de teléfonos mal formateados
 * ─────────────────────────────────────────────────────────────────
 * Corrige números como "+3006204200" → "573006204200"
 * cuando la lógica anterior añadió + sin código de país.
 *
 * Uso: node fix-phones.js [codigo_pais]
 * Ej : node fix-phones.js 57   (Colombia, defecto)
 *      node fix-phones.js 52   (México)
 *      node fix-phones.js 58   (Venezuela)
 */

const fs = require('fs');
const path = require('path');

// ── Argumento: código de país a usar para números sin código ─
const defaultCountryCode = process.argv[2] || '57'; // Colombia por defecto

const DATA_FILE = path.join(__dirname, 'data', 'prospects.json');

function needsCountryCode(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  // Si el número tiene 10 dígitos exactos → probable número local sin código
  // Colombia: los celulares empiezan en 3xx (10 dígitos)
  // México: 10 dígitos también
  return digits.length === 10;
}

function fixPhone(phone, cc) {
  if (!phone) return phone;
  const raw = String(phone).trim();
  const digits = raw.replace(/\D/g, '');

  if (!digits) return phone;

  // ¿Ya tiene código de país? (>= 11 dígitos)
  if (digits.length >= 11) return digits;

  // Número local de 10 dígitos → añadir código de país configurado
  if (digits.length === 10) {
    const fixed = cc + digits;
    return fixed;
  }

  return digits; // devolver como está para otros casos
}

try {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const prospects = JSON.parse(raw);

  let fixed = 0;
  const updated = prospects.map(p => {
    const origPhone    = p.phone    || '';
    const origWhatsapp = p.whatsapp || '';

    const newPhone    = fixPhone(origPhone,    defaultCountryCode);
    const newWhatsapp = fixPhone(origWhatsapp, defaultCountryCode);

    if (newPhone !== origPhone || newWhatsapp !== origWhatsapp) {
      fixed++;
      console.log(`✓ "${p.name}": ${origPhone} → ${newPhone}`);
      return { ...p, phone: newPhone, whatsapp: newWhatsapp };
    }
    return p;
  });

  fs.writeFileSync(DATA_FILE, JSON.stringify(updated, null, 2), 'utf8');
  console.log(`\n✅ Completado: ${fixed} números corregidos de ${prospects.length} prospectos`);
  console.log(`   Código de país usado: +${defaultCountryCode}`);
  console.log(`\n   Si tus clientes son de otro país, ejecuta:`);
  console.log(`   node fix-phones.js 52   (México)`);
  console.log(`   node fix-phones.js 58   (Venezuela)`);
  console.log(`   node fix-phones.js 51   (Perú)`);

} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
