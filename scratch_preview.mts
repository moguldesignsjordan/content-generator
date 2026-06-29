import { renderEmailTemplate, resolveBrandTokens } from "./lib/email/templates/index.ts";

const tokens = resolveBrandTokens({
  id: "x", name: "Mogul Design Agency",
  visual_identity: { footer: { website: "https://moguldesignagency.com", social: { linkedin: "#", instagram: "#" } } },
  mailerlite_config: { sender_name: "Jordan at Mogul" },
} as any);

const tip = { subject:"s", preheader:"The one positioning mistake that quietly kills startup brands", headline:"Your tagline is not your positioning", body_sections:[{ body:"Most founders pick a clever tagline and call it positioning. But positioning is the decision underneath the tagline: who you are for, what you replace, and why you win.\n\nNail that first. The words get easy once the strategy is sharp." }], cta_text:"See how we do it", cta_url:"#" };

const feature = { subject:"s", preheader:"Seven signals it is time to rebrand", headline:"7 signs your startup has outgrown its brand", body_sections:[
  { body:"Brands rarely fail loudly. They drift. Here are the signals we see right before a founder finally calls us." },
  { heading:"1. You apologize before sharing your site", body:"If you preface every link with \"ignore the design,\" your brand is already costing you deals." },
  { heading:"2. Sales keeps re-explaining what you do", body:"When the brand does not carry the message, your team carries it manually, every single call." },
], cta_text:"Book a brand audit", cta_url:"#" };

const howto = { subject:"s", preheader:"A repeatable way to choose brand colors", headline:"How to choose brand colors that convert", body_sections:[
  { heading:"Start with contrast, not taste", body:"Pick colors that pass accessibility contrast first. Pretty palettes that fail are worthless." },
  { heading:"Limit to one accent", body:"One confident accent color does more than a rainbow. Use it only for actions." },
  { heading:"Test in the real layout", body:"Colors lie in isolation. Drop them into an actual screen before committing." },
], cta_text:"Get the full guide", cta_url:"#" };

const out = [
  ["TIP","newsletter_tip",tip],["FEATURE","newsletter_feature",feature],["HOWTO","newsletter_howto",howto],
].map(([label,id,copy]:any)=>`<h3 style="font-family:sans-serif">${label}</h3>`+renderEmailTemplate(id,{copy,tokens})).join("<hr/>");
console.log(out);
