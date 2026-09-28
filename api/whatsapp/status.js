import { getWhatsAppConfig, getGymNameFromEnv } from "../../server/lib/whatsapp.js";
import { getRendererInfo } from "../../server/lib/card-renderer.js";

// Reports whether automatic WhatsApp receipts can be sent right now.
//
// This deliberately returns only booleans and the name of the missing variable -
// never the access token or the phone number id. It exists so the UI can warn
// the owner *before* they record a payment, instead of letting them discover
// days later that nothing was ever delivered.
//
// The three card fields together decide whether the blue card can go out:
// the rasteriser must be loadable, at least one font must be found, and there
// must be a public base URL for WhatsApp to fetch the image from.
export default async function handler(_req, res) {
  const config = getWhatsAppConfig();
  const renderer = await getRendererInfo();
  res.json({
    configured: config.configured,
    missing: config.missing,
    dryRun: config.dryRun,
    gymName: getGymNameFromEnv(),
    templateName: config.templateName,
    language: config.language,
    receiptStyle: config.receiptStyle,
    cardRendering: renderer.available,
    cardFontCount: renderer.fontCount,
    cardUrlConfigured: Boolean(config.publicBaseUrl),
  });
}
