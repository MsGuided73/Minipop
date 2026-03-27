import fs from 'fs';
try {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyCurQBsME8NeLk5yY4_dA4ACvIGXVOgz0U");
  const data = await r.json();
  if (data.models) {
    const models = data.models.filter(m => m.name.includes("imagen") || m.name.includes("image"));
    fs.writeFileSync('C:/Users/benso/OneDrive/Desktop/Derek/____PROJECTS/PoppyAI/models.json', JSON.stringify(models, null, 2));
  } else {
    console.error("No models found:", data);
  }
} catch (e) {
  console.error("Fetch failed:", e);
}
