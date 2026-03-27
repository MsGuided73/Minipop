import fs from 'fs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
try {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=AIzaSyCurQBsME8NeLk5yY4_dA4ACvIGXVOgz0U", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: "A tiny red apple" }],
      parameters: { sampleCount: 1 }
    })
  });
  const text = await r.text();
  fs.writeFileSync('C:/Users/benso/OneDrive/Desktop/Derek/____PROJECTS/PoppyAI/imagen_response.json', text);
} catch (e) {
  console.error("Fetch failed:", e);
}
