/**
 * AI Module — Generación de mensajes de prospección con Claude
 */

const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada. Ve a Configuración → IA.');
  return new Anthropic({ apiKey });
}

const TONES = {
  profesional: 'profesional, formal y directo. Genera confianza desde el primer mensaje.',
  amigable:    'cálido, cercano y conversacional. Como si fuera un conocido.',
  consultivo:  'consultor experto que ofrece valor y soluciones, no ventas agresivas.',
  urgente:     'con sentido de urgencia y oportunidad limitada, sin sonar desesperado.',
};

async function generateMessages({ businessName, city, category, hasWebsite, tone = 'profesional', count = 3, language = 'es' }) {
  const client = getClient();

  const toneDesc = TONES[tone] || TONES.profesional;
  const websiteContext = hasWebsite
    ? 'El negocio ya tiene página web, así que enfócate en mejorar su presencia digital o resultados.'
    : 'El negocio NO tiene página web, lo cual es una oportunidad enorme para ofrecerle servicios digitales.';

  const systemPrompt = `Eres un experto en copywriting para prospección de negocios locales vía WhatsApp en Latinoamérica.
Generas mensajes cortos, naturales y de alta conversión. Tono: ${toneDesc}

REGLAS ESTRICTAS:
- Máximo 3 oraciones por mensaje
- Usa spintax con {opcion1|opcion2|opcion3} para variaciones de palabras/frases
- Incluye SIEMPRE la variable {nombre} para personalizar con el nombre del negocio
- Puedes usar {ciudad}, {categoria} como variables adicionales
- NO uses emojis excesivos (máximo 1-2 por mensaje)
- NO menciones precios
- El mensaje debe generar curiosidad o una pregunta, no cerrar la venta
- Termina con una pregunta abierta o CTA suave
- ${websiteContext}`;

  const userPrompt = `Genera exactamente ${count} variantes de mensaje de prospección para:
- Nombre del negocio: ${businessName || '{nombre}'}
- Ciudad: ${city || '{ciudad}'}
- Categoría/Nicho: ${category || '{categoria}'}

Devuelve SOLO un JSON array con esta estructura exacta, sin markdown:
[
  { "text": "mensaje con spintax usando {nombre}", "label": "Variante 1 - descripción breve del enfoque" },
  { "text": "...", "label": "..." }
]`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content[0].text.trim();

  // Parsear JSON — limpiar si viene con markdown
  const jsonStr = raw.replace(/^```json?\n?/i, '').replace(/```$/m, '').trim();
  const variants = JSON.parse(jsonStr);

  if (!Array.isArray(variants)) throw new Error('Respuesta IA con formato inesperado');

  return variants.map((v, i) => ({
    text:  v.text  || '',
    label: v.label || `Variante ${i + 1}`,
  }));
}

async function improveMessage({ originalMessage, instruction }) {
  const client = getClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Mejora este mensaje de prospección WhatsApp siguiendo la instrucción:\n\nMensaje original:\n"${originalMessage}"\n\nInstrucción: ${instruction}\n\nDevuelve SOLO el mensaje mejorado, sin explicaciones.`,
    }],
  });

  return response.content[0].text.trim();
}

module.exports = { generateMessages, improveMessage };
